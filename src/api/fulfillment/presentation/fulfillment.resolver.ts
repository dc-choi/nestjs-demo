import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Resolver } from '@nestjs/graphql';

import { FulfillmentService } from '~/api/fulfillment/application/fulfillment.service.js';
import { CreateFulfillmentInput } from '~/api/fulfillment/presentation/create-fulfillment.input.js';
import { FulfillmentIdInput } from '~/api/fulfillment/presentation/fulfillment-id.input.js';
import { toFulfillmentPayload } from '~/api/fulfillment/presentation/fulfillment.mapper.js';
import { FulfillmentPayload } from '~/api/fulfillment/presentation/fulfillment.payload.js';
import { ShipFulfillmentInput } from '~/api/fulfillment/presentation/ship-fulfillment.input.js';
import { parseGraphqlId } from '~/global/graphql/graphql-id.parser.js';
import { Jwt } from '~/global/jwt/decorator/jwt.decorator.js';
import { AdminGuard } from '~/global/jwt/guard/admin.guard.js';
import type { JwtPayload } from '~/global/jwt/payload/jwt.payload.js';

@Resolver()
export class FulfillmentResolver {
    constructor(private readonly fulfillmentService: FulfillmentService) {}

    @Mutation(() => FulfillmentPayload)
    @UseGuards(AdminGuard)
    async createFulfillment(
        @Jwt() jwtPayload: JwtPayload,
        @Args('input') input: CreateFulfillmentInput
    ): Promise<FulfillmentPayload> {
        const fulfillment = await this.fulfillmentService.create(jwtPayload, {
            orderId: parseGraphqlId(input.orderId, '주문 ID'),
            idempotencyKey: input.idempotencyKey,
            items: input.items.map(({ orderItemId, quantity }) => ({
                orderItemId: parseGraphqlId(orderItemId, '주문 품목 ID'),
                quantity,
            })),
        });
        return toFulfillmentPayload(fulfillment);
    }

    @Mutation(() => FulfillmentPayload)
    @UseGuards(AdminGuard)
    async packFulfillment(
        @Jwt() jwtPayload: JwtPayload,
        @Args('input') input: FulfillmentIdInput
    ): Promise<FulfillmentPayload> {
        return toFulfillmentPayload(
            await this.fulfillmentService.pack(jwtPayload, parseGraphqlId(input.fulfillmentId, '배송 ID'))
        );
    }

    @Mutation(() => FulfillmentPayload)
    @UseGuards(AdminGuard)
    async shipFulfillment(
        @Jwt() jwtPayload: JwtPayload,
        @Args('input') input: ShipFulfillmentInput
    ): Promise<FulfillmentPayload> {
        return toFulfillmentPayload(
            await this.fulfillmentService.ship(jwtPayload, {
                fulfillmentId: parseGraphqlId(input.fulfillmentId, '배송 ID'),
                carrier: input.carrier,
                trackingNumber: input.trackingNumber,
            })
        );
    }

    @Mutation(() => FulfillmentPayload)
    @UseGuards(AdminGuard)
    async deliverFulfillment(
        @Jwt() jwtPayload: JwtPayload,
        @Args('input') input: FulfillmentIdInput
    ): Promise<FulfillmentPayload> {
        return toFulfillmentPayload(
            await this.fulfillmentService.deliver(jwtPayload, parseGraphqlId(input.fulfillmentId, '배송 ID'))
        );
    }

    @Mutation(() => FulfillmentPayload)
    @UseGuards(AdminGuard)
    async cancelFulfillment(
        @Jwt() jwtPayload: JwtPayload,
        @Args('input') input: FulfillmentIdInput
    ): Promise<FulfillmentPayload> {
        return toFulfillmentPayload(
            await this.fulfillmentService.cancel(jwtPayload, parseGraphqlId(input.fulfillmentId, '배송 ID'))
        );
    }
}
