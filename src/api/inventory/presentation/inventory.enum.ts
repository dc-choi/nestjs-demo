import { registerEnumType } from '@nestjs/graphql';

import { InventoryMovementType } from '~/api/inventory/domain/entity/inventory-movement-type.js';
import { InventoryReservationStatus } from '~/api/inventory/domain/entity/inventory-reservation-status.js';

const InventoryAdjustmentType = {
    RECEIPT: InventoryMovementType.RECEIPT,
    ADJUSTMENT: InventoryMovementType.ADJUSTMENT,
    RETURN: InventoryMovementType.RETURN,
} as const;

registerEnumType(InventoryReservationStatus, { name: 'InventoryReservationStatus' });
registerEnumType(InventoryMovementType, { name: 'InventoryMovementType' });
registerEnumType(InventoryAdjustmentType, { name: 'InventoryAdjustmentType' });

export { InventoryAdjustmentType, InventoryMovementType, InventoryReservationStatus };
