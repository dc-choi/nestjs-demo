import { Field, ObjectType } from '@nestjs/graphql';

import { InventoryMovementRecordType } from './inventory-movement-record.type.js';

@ObjectType()
export class InventoryAdjustmentPayload {
    @Field(() => InventoryMovementRecordType)
    movement!: InventoryMovementRecordType;
}
