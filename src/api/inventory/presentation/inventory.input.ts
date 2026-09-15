import { Field, ID, InputType, Int } from '@nestjs/graphql';

import { IsEnum, IsNotEmpty, IsNumber, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { InventoryAdjustmentType } from '~/api/inventory/presentation/inventory-reservation-status.enum';
import { MYSQL_SIGNED_INT_MAX, MYSQL_SIGNED_INT_MIN } from '~/global/common/utils/mysql-number';
import { GRAPHQL_ID_MAX_LENGTH, GRAPHQL_ID_PATTERN } from '~/global/graphql/graphql-id.parser';

@InputType()
export class RestoreInventoryReservationInput {
    @Field(() => ID)
    @Matches(GRAPHQL_ID_PATTERN)
    @MaxLength(GRAPHQL_ID_MAX_LENGTH)
    reservationId!: string;

    @Field()
    @IsString()
    @IsNotEmpty()
    @MaxLength(128)
    idempotencyKey!: string;
}

@InputType()
export class AdjustInventoryInput {
    @Field(() => ID)
    @Matches(GRAPHQL_ID_PATTERN)
    @MaxLength(GRAPHQL_ID_MAX_LENGTH)
    itemId!: string;

    @Field(() => InventoryAdjustmentType)
    @IsEnum(InventoryAdjustmentType)
    type!:
        | typeof InventoryAdjustmentType.RECEIPT
        | typeof InventoryAdjustmentType.ADJUSTMENT
        | typeof InventoryAdjustmentType.RETURN;

    @Field(() => Int)
    @IsNumber()
    @Min(MYSQL_SIGNED_INT_MIN)
    @Max(MYSQL_SIGNED_INT_MAX)
    quantityDelta!: number;

    @Field()
    @IsString()
    @IsNotEmpty()
    @MaxLength(255)
    reason!: string;

    @Field()
    @IsString()
    @IsNotEmpty()
    @MaxLength(128)
    idempotencyKey!: string;
}
