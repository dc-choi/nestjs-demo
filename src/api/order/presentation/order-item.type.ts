import { Field, ID, Int, ObjectType } from '@nestjs/graphql';

import { OrderedItemSnapshotType } from '~/api/order/presentation/ordered-item-snapshot.type.js';
import { MoneyType } from '~/global/graphql/money.type.js';

@ObjectType('OrderItem')
export class OrderItemType {
    @Field(() => ID)
    id!: string;

    @Field(() => ID)
    itemId!: string;

    @Field(() => Int)
    quantity!: number;

    @Field(() => MoneyType)
    lineTotalPrice!: MoneyType;

    @Field(() => OrderedItemSnapshotType)
    snapshot!: OrderedItemSnapshotType;
}
