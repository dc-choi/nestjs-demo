import { Field, ID, Int, ObjectType } from '@nestjs/graphql';

import { ProductCategoryPathNodeType } from './product-category-path-node.type';

@ObjectType('ProductCategory')
export class ProductCategoryType {
    @Field(() => ID)
    id: string;

    @Field()
    name: string;

    @Field()
    slug: string;

    @Field(() => Int)
    sequence: number;

    @Field(() => [ProductCategoryPathNodeType])
    path: ProductCategoryPathNodeType[];
}
