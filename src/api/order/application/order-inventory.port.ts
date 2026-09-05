import type { InventoryReservationEntity } from '~/api/inventory/domain/inventory-reservation.entity';
import type { OrderItemEntity } from '~/api/order/domain/entity/order-item.entity';

export const ORDER_INVENTORY_PORT = Symbol('ORDER_INVENTORY_PORT');

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
