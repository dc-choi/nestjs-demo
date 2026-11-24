import { Field, ID, ObjectType } from '@nestjs/graphql';

import { OrderItemType } from '~/api/order/presentation/order-item.type.js';
import { OrderStatus } from '~/api/order/presentation/order-status.enum.js';
import { MoneyType } from '~/global/graphql/money.type.js';

@ObjectType('Order')
export class OrderType {
    @Field(() => ID)
    id!: string;

    @Field()
    orderNumber!: string;

    @Field(() => OrderStatus)
    status!: OrderStatus;

    @Field()
    currencyCode!: string;

    @Field(() => MoneyType)
    totalPrice!: MoneyType;

    @Field(() => Date)
    createdAt!: Date;

    @Field(() => [OrderItemType])
    items!: OrderItemType[];
}
