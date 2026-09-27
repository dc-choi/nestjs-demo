import { Field, ID, Int, ObjectType } from '@nestjs/graphql';

import { InventoryMovementType as InventoryMovementKind } from '~/api/inventory/presentation/inventory-reservation-status.enum';

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
