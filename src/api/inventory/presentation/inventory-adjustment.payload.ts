import { Field, ObjectType } from '@nestjs/graphql';

import { InventoryMovementType } from './inventory-movement.type';

@ObjectType()
export class InventoryAdjustmentPayload {
    @Field(() => InventoryMovementType)
    movement!: InventoryMovementType;
}
