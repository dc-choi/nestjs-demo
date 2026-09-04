import { registerEnumType } from '@nestjs/graphql';

import { InventoryMovementType, InventoryReservationStatus } from '~/api/inventory/domain/inventory.enum';

const InventoryAdjustmentType = {
    RECEIPT: InventoryMovementType.RECEIPT,
    ADJUSTMENT: InventoryMovementType.ADJUSTMENT,
    RETURN: InventoryMovementType.RETURN,
} as const;

registerEnumType(InventoryReservationStatus, { name: 'InventoryReservationStatus' });
registerEnumType(InventoryMovementType, { name: 'InventoryMovementType' });
registerEnumType(InventoryAdjustmentType, { name: 'InventoryAdjustmentType' });

export { InventoryAdjustmentType, InventoryMovementType, InventoryReservationStatus };
