import { Field, ObjectType } from '@nestjs/graphql';

import { FulfillmentType } from './fulfillment.type.js';

@ObjectType()
export class FulfillmentPayload {
    @Field(() => FulfillmentType)
    fulfillment!: FulfillmentType;
}
