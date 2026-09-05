import { Field, ID, Int, ObjectType } from '@nestjs/graphql';

import { OrderedItemSnapshotType } from '~/api/order/presentation/ordered-item-snapshot.type';
import { MoneyType } from '~/global/graphql/money.type';

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
