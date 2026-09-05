import { Field, ID, ObjectType } from '@nestjs/graphql';

import { MoneyType } from '~/global/graphql/money.type';

@ObjectType('ProductSearchThumbnail')
export class ProductSearchThumbnailType {
    @Field()
    url!: string;

    @Field(() => String, { nullable: true })
    altText!: string | null;
}

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

@ObjectType('ProductSearchPageInfo')
export class ProductSearchPageInfoType {
    @Field()
    hasNextPage!: boolean;

    @Field(() => String, { nullable: true })
    endCursor!: string | null;
}

@ObjectType('ProductSearchConnection')
export class ProductSearchConnectionType {
    @Field(() => [ProductSearchNodeType])
    nodes!: ProductSearchNodeType[];

    @Field(() => ProductSearchPageInfoType)
    pageInfo!: ProductSearchPageInfoType;
}
