import { Field, ID, InputType, Int } from '@nestjs/graphql';

import { Type } from 'class-transformer';
import {
    ArrayMinSize,
    IsNotEmpty,
    IsNumber,
    IsString,
    Matches,
    Max,
    MaxLength,
    Min,
    ValidateNested,
} from 'class-validator';
import { MYSQL_SIGNED_INT_MAX } from '~/global/common/utils/mysql-number';
import { GRAPHQL_ID_MAX_LENGTH, GRAPHQL_ID_PATTERN } from '~/global/graphql/graphql-id.parser';

@InputType()
export class FulfillmentAllocationInput {
    @Field(() => ID)
    @Matches(GRAPHQL_ID_PATTERN)
    @MaxLength(GRAPHQL_ID_MAX_LENGTH)
    orderItemId!: string;

    @Field(() => Int)
    @IsNumber()
    @Min(1)
    @Max(MYSQL_SIGNED_INT_MAX)
    quantity!: number;
}

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

@InputType()
export class FulfillmentIdInput {
    @Field(() => ID)
    @Matches(GRAPHQL_ID_PATTERN)
    @MaxLength(GRAPHQL_ID_MAX_LENGTH)
    fulfillmentId!: string;
}

@InputType()
export class ShipFulfillmentInput extends FulfillmentIdInput {
    @Field()
    @IsString()
    @IsNotEmpty()
    @MaxLength(128)
    carrier!: string;

    @Field()
    @IsString()
    @IsNotEmpty()
    @MaxLength(255)
    trackingNumber!: string;
}
