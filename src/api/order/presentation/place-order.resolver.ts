import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Resolver } from '@nestjs/graphql';

import { OrderService } from '~/api/order/application/order.service.js';
import { CancelOrderInput } from '~/api/order/presentation/cancel-order.input.js';
import { toOrderType } from '~/api/order/presentation/order.mapper.js';
import { PlaceOrderInput } from '~/api/order/presentation/place-order.input.js';
import { toPlaceOrderCommand } from '~/api/order/presentation/place-order.mapper.js';
import { PlaceOrderPayload } from '~/api/order/presentation/place-order.payload.js';
import { parseGraphqlId } from '~/global/graphql/graphql-id.parser.js';
import { Jwt } from '~/global/jwt/decorator/jwt.decorator.js';
import { CommonGuard } from '~/global/jwt/guard/common.guard.js';
import type { JwtPayload } from '~/global/jwt/payload/jwt.payload.js';

@Resolver()
export class OrderResolver {
    constructor(private readonly orderService: OrderService) {}

    @Mutation(() => PlaceOrderPayload)
    @UseGuards(CommonGuard)
    async placeOrder(@Jwt() jwtPayload: JwtPayload, @Args('input') input: PlaceOrderInput): Promise<PlaceOrderPayload> {
        const order = await this.orderService.order(jwtPayload, toPlaceOrderCommand(input));

        return { order: toOrderType(order) };
    }

    @Mutation(() => PlaceOrderPayload)
    @UseGuards(CommonGuard)
    async cancelOrder(
        @Jwt() jwtPayload: JwtPayload,
        @Args('input') input: CancelOrderInput
    ): Promise<PlaceOrderPayload> {
        const order = await this.orderService.cancel(jwtPayload, {
            orderId: parseGraphqlId(input.orderId, '주문 ID'),
            idempotencyKey: input.idempotencyKey,
            reason: input.reason,
        });
        return { order: toOrderType(order) };
    }
}
