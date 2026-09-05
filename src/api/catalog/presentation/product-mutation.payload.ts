import { Field, ID, Int, ObjectType } from '@nestjs/graphql';

import { ProductStatus } from '~/api/catalog/presentation/product-status.enum';

@ObjectType()
export class ProductMutationPayload {
    @Field(() => ID)
    productId!: string;

    @Field(() => Int)
    revision!: number;

    @Field(() => ProductStatus)
    status!: ProductStatus;

    @Field(() => Date, { nullable: true })
    deletedAt!: Date | null;
}
