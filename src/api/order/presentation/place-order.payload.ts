import { Field, ObjectType } from '@nestjs/graphql';

import { OrderType } from '~/api/order/presentation/order.type';

@ObjectType()
export class PlaceOrderPayload {
    @Field(() => OrderType)
    order!: OrderType;
}
