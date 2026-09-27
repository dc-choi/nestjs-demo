import { Field, ID, Int, ObjectType } from '@nestjs/graphql';

@ObjectType('FulfillmentItem')
export class FulfillmentItemType {
    @Field(() => ID)
    id!: string;

    @Field(() => ID)
    orderItemId!: string;

    @Field(() => Int)
    quantity!: number;
}
