import { Field, ObjectType } from '@nestjs/graphql';

import { InventoryMovementType } from './inventory-movement.type';
import { InventoryReservationType } from './inventory-reservation.type';

@ObjectType()
export class InventoryTransitionPayload {
    @Field(() => InventoryReservationType)
    reservation!: InventoryReservationType;

    @Field(() => InventoryMovementType, { nullable: true })
    movement!: InventoryMovementType | null;
}
