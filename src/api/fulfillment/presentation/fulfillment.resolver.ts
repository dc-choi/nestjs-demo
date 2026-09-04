import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Resolver } from '@nestjs/graphql';

import { FulfillmentService } from '~/api/fulfillment/application/fulfillment.service';
import {
    CreateFulfillmentInput,
    FulfillmentIdInput,
    ShipFulfillmentInput,
    parseFulfillmentId,
} from '~/api/fulfillment/presentation/fulfillment.input';
import { toFulfillmentPayload } from '~/api/fulfillment/presentation/fulfillment.mapper';
import { FulfillmentPayload } from '~/api/fulfillment/presentation/fulfillment.type';
import { Jwt } from '~/global/jwt/decorator/jwt.decorator';
import { AdminGuard } from '~/global/jwt/guard/admin.guard';
import type { JwtPayload } from '~/global/jwt/payload/jwt.payload';

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
            orderId: parseFulfillmentId(input.orderId),
            idempotencyKey: input.idempotencyKey,
            items: input.items.map(({ orderItemId, quantity }) => ({
                orderItemId: parseFulfillmentId(orderItemId),
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
            await this.fulfillmentService.pack(jwtPayload, parseFulfillmentId(input.fulfillmentId))
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
                fulfillmentId: parseFulfillmentId(input.fulfillmentId),
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
            await this.fulfillmentService.deliver(jwtPayload, parseFulfillmentId(input.fulfillmentId))
        );
    }

    @Mutation(() => FulfillmentPayload)
    @UseGuards(AdminGuard)
    async cancelFulfillment(
        @Jwt() jwtPayload: JwtPayload,
        @Args('input') input: FulfillmentIdInput
    ): Promise<FulfillmentPayload> {
        return toFulfillmentPayload(
            await this.fulfillmentService.cancel(jwtPayload, parseFulfillmentId(input.fulfillmentId))
        );
    }
}
