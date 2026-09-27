import { Field, ID, InputType } from '@nestjs/graphql';

import { Matches, MaxLength } from 'class-validator';
import { GRAPHQL_ID_MAX_LENGTH, GRAPHQL_ID_PATTERN } from '~/global/graphql/graphql-id.parser';

@InputType()
export class FulfillmentIdInput {
    @Field(() => ID)
    @Matches(GRAPHQL_ID_PATTERN)
    @MaxLength(GRAPHQL_ID_MAX_LENGTH)
    fulfillmentId!: string;
}
