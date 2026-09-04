import { BadRequestException } from '@nestjs/common';
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

const DECIMAL_ID_PATTERN = /^[1-9]\d*$/;

@InputType()
export class FulfillmentAllocationInput {
    @Field(() => ID)
    @Matches(DECIMAL_ID_PATTERN)
    @MaxLength(19)
    orderItemId: string;

    @Field(() => Int)
    @IsNumber()
    @Min(1)
    @Max(MYSQL_SIGNED_INT_MAX)
    quantity: number;
}

@InputType()
export class CreateFulfillmentInput {
    @Field(() => ID)
    @Matches(DECIMAL_ID_PATTERN)
    @MaxLength(19)
    orderId: string;

    @Field()
    @IsString()
    @IsNotEmpty()
    @MaxLength(128)
    idempotencyKey: string;

    @Field(() => [FulfillmentAllocationInput])
    @Type(() => FulfillmentAllocationInput)
    @ArrayMinSize(1)
    @ValidateNested({ each: true })
    items: FulfillmentAllocationInput[];
}

@InputType()
export class FulfillmentIdInput {
    @Field(() => ID)
    @Matches(DECIMAL_ID_PATTERN)
    @MaxLength(19)
    fulfillmentId: string;
}

@InputType()
export class ShipFulfillmentInput extends FulfillmentIdInput {
    @Field()
    @IsString()
    @IsNotEmpty()
    @MaxLength(128)
    carrier: string;

    @Field()
    @IsString()
    @IsNotEmpty()
    @MaxLength(255)
    trackingNumber: string;
}

export function parseFulfillmentId(value: string): bigint {
    if (value.length > 19 || !DECIMAL_ID_PATTERN.test(value)) {
        throw new BadRequestException('유효하지 않은 ID입니다.');
    }
    const id = BigInt(value);
    if (id > 9_223_372_036_854_775_807n) throw new BadRequestException('유효하지 않은 ID입니다.');
    return id;
}
