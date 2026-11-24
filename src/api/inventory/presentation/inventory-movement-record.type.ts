import { Field, ID, Int, ObjectType } from '@nestjs/graphql';

import { InventoryMovementType } from '~/api/inventory/presentation/inventory.enum.js';

@ObjectType('InventoryMovement')
export class InventoryMovementRecordType {
    @Field(() => ID)
    id!: string;

    @Field(() => InventoryMovementType)
    type!: InventoryMovementType;

    @Field(() => Int)
    quantityDelta!: number;

    @Field(() => Int)
    stockAfter!: number;

    @Field()
    itemSku!: string;
}
