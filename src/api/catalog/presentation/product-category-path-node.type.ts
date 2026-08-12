import { Field, ID, ObjectType } from '@nestjs/graphql';

@ObjectType('ProductCategoryPathNode')
export class ProductCategoryPathNodeType {
    @Field(() => ID)
    id: string;

    @Field()
    name: string;

    @Field()
    slug: string;
}
