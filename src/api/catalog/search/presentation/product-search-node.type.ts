import { Field, ID, ObjectType } from '@nestjs/graphql';

import { ProductSearchThumbnailType } from './product-search-thumbnail.type';

import { MoneyType } from '~/global/graphql/money.type';

@ObjectType('ProductSearchNode')
export class ProductSearchNodeType {
    @Field(() => ID)
    productId!: string;

    @Field()
    slug!: string;

    @Field()
    name!: string;

    @Field(() => ID)
    itemId!: string;

    @Field()
    itemName!: string;

    @Field(() => MoneyType)
    price!: MoneyType;

    @Field(() => ProductSearchThumbnailType, { nullable: true })
    thumbnail!: ProductSearchThumbnailType | null;
}
