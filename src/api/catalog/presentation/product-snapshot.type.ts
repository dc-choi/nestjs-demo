import { Field, ID, Int, ObjectType } from '@nestjs/graphql';

import { ProductSnapshotChangeType } from '~/api/catalog/presentation/product-snapshot-change-type.enum';

@ObjectType('ProductSnapshot')
export class ProductSnapshotType {
    @Field(() => ID)
    id!: string;

    @Field(() => ID)
    productId!: string;

    @Field(() => Int)
    revision!: number;

    @Field(() => Int)
    schemaVersion!: number;

    @Field(() => ProductSnapshotChangeType)
    changeType!: ProductSnapshotChangeType;

    @Field(() => String, { nullable: true })
    reason!: string | null;

    @Field(() => ID, { nullable: true })
    changedByMemberId!: string | null;

    @Field(() => Date)
    createdAt!: Date;
}
