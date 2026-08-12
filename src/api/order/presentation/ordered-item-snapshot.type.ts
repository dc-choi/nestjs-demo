import { Field, ID, ObjectType } from '@nestjs/graphql';

import { SelectedOrderOptionType } from '~/api/order/presentation/selected-order-option.type';
import { MoneyType } from '~/global/graphql/money.type';

@ObjectType('OrderedItemSnapshot')
export class OrderedItemSnapshotType {
    @Field(() => ID)
    productSnapshotId: string;

    @Field()
    productName: string;

    @Field()
    itemName: string;

    @Field()
    itemSku: string;

    @Field(() => String, { nullable: true })
    productDescription: string | null;

    @Field(() => String, { nullable: true })
    productReturnPolicy: string | null;

    @Field(() => MoneyType)
    unitSupplyPrice: MoneyType;

    @Field(() => MoneyType)
    unitVat: MoneyType;

    @Field(() => MoneyType)
    unitTotalPrice: MoneyType;

    @Field()
    isTaxFree: boolean;

    @Field(() => [SelectedOrderOptionType])
    selectedOptions: SelectedOrderOptionType[];
}
