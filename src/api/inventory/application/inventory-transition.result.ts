import type { InventoryMovementEntity } from '~/api/inventory/domain/entity/inventory-movement.entity.js';
import type { InventoryReservationEntity } from '~/api/inventory/domain/entity/inventory-reservation.entity.js';

/** The reservation a transition touched and the ledger row it produced, or null when no stock moved. */
export interface InventoryTransitionResult {
    readonly reservation: InventoryReservationEntity;
    readonly movement: InventoryMovementEntity | null;
}
