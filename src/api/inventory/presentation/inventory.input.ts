import { BadRequestException } from '@nestjs/common';
import { Field, ID, InputType, Int } from '@nestjs/graphql';

import { IsEnum, IsNotEmpty, IsNumber, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { InventoryAdjustmentType } from '~/api/inventory/presentation/inventory-reservation-status.enum';
import { MYSQL_SIGNED_INT_MAX, MYSQL_SIGNED_INT_MIN } from '~/global/common/utils/mysql-number';

const DECIMAL_ID_PATTERN = /^[1-9]\d*$/;

@InputType()
export class InventoryReservationInput {
    @Field(() => ID)
    @Matches(DECIMAL_ID_PATTERN)
    @MaxLength(19)
    reservationId: string;
}

@InputType()
export class RestoreInventoryReservationInput extends InventoryReservationInput {
    @Field()
    @IsString()
    @IsNotEmpty()
    @MaxLength(128)
    idempotencyKey: string;
}

@InputType()
export class AdjustInventoryInput {
    @Field(() => ID)
    @Matches(DECIMAL_ID_PATTERN)
    @MaxLength(19)
    itemId: string;

    @Field(() => InventoryAdjustmentType)
    @IsEnum(InventoryAdjustmentType)
    type:
        | typeof InventoryAdjustmentType.RECEIPT
        | typeof InventoryAdjustmentType.ADJUSTMENT
        | typeof InventoryAdjustmentType.RETURN;

    @Field(() => Int)
    @IsNumber()
    @Min(MYSQL_SIGNED_INT_MIN)
    @Max(MYSQL_SIGNED_INT_MAX)
    quantityDelta: number;

    @Field()
    @IsString()
    @IsNotEmpty()
    @MaxLength(255)
    reason: string;

    @Field()
    @IsString()
    @IsNotEmpty()
    @MaxLength(128)
    idempotencyKey: string;
}

export function parseReservationId(value: string): bigint {
    if (value.length > 19 || !DECIMAL_ID_PATTERN.test(value)) {
        throw new BadRequestException('유효하지 않은 재고 예약 ID입니다.');
    }

    const id = BigInt(value);
    if (id > 9_223_372_036_854_775_807n) throw new BadRequestException('유효하지 않은 재고 예약 ID입니다.');
    return id;
}
