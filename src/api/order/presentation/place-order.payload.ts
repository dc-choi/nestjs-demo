import { Field, ObjectType } from '@nestjs/graphql';

import { OrderType } from '~/api/order/presentation/order.type.js';

@ObjectType()
export class PlaceOrderPayload {
    @Field(() => OrderType)
    order!: OrderType;
}
