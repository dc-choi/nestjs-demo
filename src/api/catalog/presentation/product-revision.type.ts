import { Field, ID, Int, ObjectType } from '@nestjs/graphql';

import { ProductCategoryType } from './product-category.type';
import { ProductItemType } from './product-item.type';
import { ProductOptionType } from './product-option.type';

@ObjectType('ProductRevision')
export class ProductRevisionType {
    @Field(() => ID)
    id: string;

    @Field(() => Int)
    version: number;

    @Field()
    name: string;

    @Field(() => String, { nullable: true })
    description: string | null;

    @Field(() => String, { nullable: true })
    returnPolicy: string | null;

    @Field(() => Date)
    createdAt: Date;

    @Field(() => Date, { nullable: true })
    firstPublishedAt: Date | null;

    @Field(() => [ProductItemType])
    items: ProductItemType[];

    @Field(() => [ProductOptionType])
    options: ProductOptionType[];

    @Field(() => [ProductCategoryType])
    categories: ProductCategoryType[];

    @Field(() => [String])
    tags: string[];
}
