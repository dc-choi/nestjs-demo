import { Field, ObjectType } from '@nestjs/graphql';

import { InventoryMovementType } from './inventory-movement.type.js';
import { InventoryReservationType } from './inventory-reservation.type.js';

@ObjectType()
export class InventoryTransitionPayload {
    @Field(() => InventoryReservationType)
    reservation!: InventoryReservationType;

    @Field(() => InventoryMovementType, { nullable: true })
    movement!: InventoryMovementType | null;
}
