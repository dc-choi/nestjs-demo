import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Resolver } from '@nestjs/graphql';

import { OrderService } from '~/api/order/application/order.service';
import { toOrderType } from '~/api/order/presentation/order.mapper';
import { PlaceOrderInput } from '~/api/order/presentation/place-order.input';
import { toPlaceOrderCommand } from '~/api/order/presentation/place-order.mapper';
import { PlaceOrderPayload } from '~/api/order/presentation/place-order.payload';
import { Jwt } from '~/global/jwt/decorator/jwt.decorator';
import { CommonGuard } from '~/global/jwt/guard/common.guard';
import { JwtPayload } from '~/global/jwt/payload/jwt.payload';

@Resolver()
export class OrderResolver {
    constructor(private readonly orderService: OrderService) {}

    @Mutation(() => PlaceOrderPayload)
    @UseGuards(CommonGuard)
    async placeOrder(@Jwt() jwtPayload: JwtPayload, @Args('input') input: PlaceOrderInput): Promise<PlaceOrderPayload> {
        const order = await this.orderService.order(jwtPayload, toPlaceOrderCommand(input));

        return { order: toOrderType(order) };
    }
}
