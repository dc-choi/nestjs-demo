export const InventoryReservationStatus = {
    RESERVED: 'RESERVED',
    CONSUMED: 'CONSUMED',
    RELEASED: 'RELEASED',
    EXPIRED: 'EXPIRED',
} as const;

export type InventoryReservationStatus = (typeof InventoryReservationStatus)[keyof typeof InventoryReservationStatus];

export const InventoryMovementType = {
    RECEIPT: 'RECEIPT',
    ADJUSTMENT: 'ADJUSTMENT',
    RESERVATION: 'RESERVATION',
    RELEASE: 'RELEASE',
    SALE: 'SALE',
    RETURN: 'RETURN',
} as const;

export type InventoryMovementType = (typeof InventoryMovementType)[keyof typeof InventoryMovementType];
