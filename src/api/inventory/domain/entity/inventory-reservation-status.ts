export const InventoryReservationStatus = {
    RESERVED: 'RESERVED',
    CONSUMED: 'CONSUMED',
    RELEASED: 'RELEASED',
    EXPIRED: 'EXPIRED',
} as const;

export type InventoryReservationStatus = (typeof InventoryReservationStatus)[keyof typeof InventoryReservationStatus];
