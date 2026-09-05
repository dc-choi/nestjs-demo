import { Field, ID, Int, ObjectType } from '@nestjs/graphql';

import {
    InventoryMovementType as InventoryMovementKind,
    InventoryReservationStatus,
} from '~/api/inventory/presentation/inventory-reservation-status.enum';

@ObjectType('InventoryReservation')
export class InventoryReservationType {
    @Field(() => ID)
    id!: string;

    @Field(() => ID)
    orderItemId!: string;

    @Field(() => ID)
    itemId!: string;

    @Field(() => Int)
    quantity!: number;

    @Field(() => InventoryReservationStatus)
    status!: InventoryReservationStatus;

    @Field(() => Date)
    expiresAt!: Date;

    @Field(() => Date, { nullable: true })
    consumedAt!: Date | null;

    @Field(() => Date, { nullable: true })
    releasedAt!: Date | null;
}

@ObjectType('InventoryMovement')
export class InventoryMovementType {
    @Field(() => ID)
    id!: string;

    @Field(() => InventoryMovementKind)
    type!: InventoryMovementKind;

    @Field(() => Int)
    quantityDelta!: number;

    @Field(() => Int)
    stockAfter!: number;

    @Field()
    itemSku!: string;
}

@ObjectType()
export class InventoryTransitionPayload {
    @Field(() => InventoryReservationType)
    reservation!: InventoryReservationType;

    @Field(() => InventoryMovementType, { nullable: true })
    movement!: InventoryMovementType | null;
}

@ObjectType()
export class InventoryAdjustmentPayload {
    @Field(() => InventoryMovementType)
    movement!: InventoryMovementType;
}
