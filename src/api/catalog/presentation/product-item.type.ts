import { Field, ID, Int, ObjectType } from '@nestjs/graphql';

import { ProductItemOptionType } from './product-item-option.type';

import { MoneyType } from '~/global/graphql/money.type';

@ObjectType('ProductItem')
export class ProductItemType {
    @Field(() => ID)
    id!: string;

    @Field()
    sku!: string;

    @Field()
    name!: string;

    @Field(() => MoneyType)
    price!: MoneyType;

    @Field()
    isTaxFree!: boolean;

    @Field(() => Int)
    sequence!: number;

    @Field(() => [ProductItemOptionType])
    selectedOptions!: ProductItemOptionType[];
}
