import type { InventoryReservationEntity } from '~/api/inventory/domain/inventory-reservation.entity';

export const PAYMENT_INVENTORY_PORT = Symbol('PAYMENT_INVENTORY_PORT');

export interface PaymentInventoryPort {
    /** The caller holds the reservation lock and an active database transaction. */
    consumeForPayment(reservation: InventoryReservationEntity, now?: Date): void;
}
