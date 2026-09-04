import { Field, ID, Int, ObjectType } from '@nestjs/graphql';

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
}
