import { Field, ID, Int, ObjectType } from '@nestjs/graphql';

import { FulfillmentStatus } from '~/api/fulfillment/presentation/fulfillment-status.enum';

@ObjectType('FulfillmentItem')
export class FulfillmentItemType {
    @Field(() => ID)
    id!: string;

    @Field(() => ID)
    orderItemId!: string;

    @Field(() => Int)
    quantity!: number;
}

@ObjectType('Fulfillment')
export class FulfillmentType {
    @Field(() => ID)
    id!: string;

    @Field(() => ID)
    orderId!: string;

    @Field(() => FulfillmentStatus)
    status!: FulfillmentStatus;

    @Field(() => String, { nullable: true })
    carrier!: string | null;

    @Field(() => String, { nullable: true })
    trackingNumber!: string | null;

    @Field(() => Date, { nullable: true })
    packedAt!: Date | null;

    @Field(() => Date, { nullable: true })
    shippedAt!: Date | null;

    @Field(() => Date, { nullable: true })
    deliveredAt!: Date | null;

    @Field(() => Date, { nullable: true })
    cancelledAt!: Date | null;

    @Field(() => [FulfillmentItemType])
    items!: FulfillmentItemType[];
}

@ObjectType()
export class FulfillmentPayload {
    @Field(() => FulfillmentType)
    fulfillment!: FulfillmentType;
}
