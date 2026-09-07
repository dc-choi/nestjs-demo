import type { InventoryReservationEntity } from '~/api/inventory/domain/inventory-reservation.entity';
import type { OrderItemEntity } from '~/api/order/domain/entity/order-item.entity';

export const ORDER_INVENTORY_PORT = Symbol('ORDER_INVENTORY_PORT');

/**
 * In-process operations on entities managed by the caller's active transaction.
 * Placement locks products first; this collaborator then locks items in ID order.
 * Cancellation holds the order lock and restores each reservation under item/reservation locks.
 * Implementations must join that transaction, register their changes with its Unit of Work,
 * and propagate failures so the order and inventory roll back together.
 */
export interface OrderInventoryPort {
    reserveForPlacementBatch(
        lines: readonly { readonly orderItem: OrderItemEntity; readonly idempotencyKey: string }[],
        expiresAt: Date,
        orderNumber: string,
        now?: Date
    ): Promise<unknown>;
    releaseForCancellation(
        reservation: InventoryReservationEntity,
        idempotencyKey: string,
        now?: Date
    ): Promise<unknown>;
}
