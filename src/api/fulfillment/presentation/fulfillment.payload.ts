import { Field, ObjectType } from '@nestjs/graphql';

import { FulfillmentType } from './fulfillment.type';

@ObjectType()
export class FulfillmentPayload {
    @Field(() => FulfillmentType)
    fulfillment!: FulfillmentType;
}
