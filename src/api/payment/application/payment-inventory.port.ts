import type { InventoryReservationEntity } from '~/api/inventory/domain/inventory-reservation.entity';

export const PAYMENT_INVENTORY_PORT = Symbol('PAYMENT_INVENTORY_PORT');

export interface PaymentInventoryPort {
    consumeForPayment(reservation: InventoryReservationEntity, now?: Date): void;
}
