import { Field, ID, Int, ObjectType } from '@nestjs/graphql';

import { InventoryReservationStatus } from '~/api/inventory/presentation/inventory-reservation-status.enum';

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
