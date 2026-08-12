import { Field, ID, ObjectType } from '@nestjs/graphql';

import { ProductRevisionType } from './product-revision.type';

@ObjectType('Product')
export class ProductType {
    @Field(() => ID)
    id: string;

    @Field()
    slug: string;

    @Field(() => Date)
    publishedAt: Date;

    @Field(() => ProductRevisionType)
    currentRevision: ProductRevisionType;
}
