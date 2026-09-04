import { BadRequestException } from '@nestjs/common';
import { Field, ID, InputType } from '@nestjs/graphql';

import { IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

const DECIMAL_ORDER_ID_PATTERN = /^[1-9]\d*$/;

@InputType()
export class CancelOrderInput {
    @Field(() => ID)
    @Matches(DECIMAL_ORDER_ID_PATTERN)
    @MaxLength(19)
    orderId: string;

    @Field()
    @IsString()
    @IsNotEmpty()
    @MaxLength(128)
    idempotencyKey: string;

    @Field(() => String, { nullable: true })
    @IsOptional()
    @IsString()
    @IsNotEmpty()
    @MaxLength(255)
    reason?: string | null;
}

export function parseOrderId(value: string): bigint {
    if (value.length > 19 || !DECIMAL_ORDER_ID_PATTERN.test(value)) {
        throw new BadRequestException('유효하지 않은 주문 ID입니다.');
    }
    const id = BigInt(value);
    if (id > 9_223_372_036_854_775_807n) throw new BadRequestException('유효하지 않은 주문 ID입니다.');
    return id;
}
