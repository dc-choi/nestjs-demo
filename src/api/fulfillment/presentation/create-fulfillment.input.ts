import { Field, ID, InputType } from '@nestjs/graphql';

import { FulfillmentAllocationInput } from './fulfillment-allocation.input';

import { Type } from 'class-transformer';
import { ArrayMinSize, IsNotEmpty, IsString, Matches, MaxLength, ValidateNested } from 'class-validator';
import { GRAPHQL_ID_MAX_LENGTH, GRAPHQL_ID_PATTERN } from '~/global/graphql/graphql-id.parser';

@InputType()
export class CreateFulfillmentInput {
    @Field(() => ID)
    @Matches(GRAPHQL_ID_PATTERN)
    @MaxLength(GRAPHQL_ID_MAX_LENGTH)
    orderId!: string;

    @Field()
    @IsString()
    @IsNotEmpty()
    @MaxLength(128)
    idempotencyKey!: string;

    @Field(() => [FulfillmentAllocationInput])
    @Type(() => FulfillmentAllocationInput)
    @ArrayMinSize(1)
    @ValidateNested({ each: true })
    items!: FulfillmentAllocationInput[];
}
