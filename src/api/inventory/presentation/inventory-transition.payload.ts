import { Field, ObjectType } from '@nestjs/graphql';

import { InventoryMovementRecordType } from './inventory-movement-record.type.js';
import { InventoryReservationType } from './inventory-reservation.type.js';

@ObjectType()
export class InventoryTransitionPayload {
    @Field(() => InventoryReservationType)
    reservation!: InventoryReservationType;

    @Field(() => InventoryMovementRecordType, { nullable: true })
    movement!: InventoryMovementRecordType | null;
}
