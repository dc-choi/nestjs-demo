export const InventoryMovementType = {
    RECEIPT: 'RECEIPT',
    ADJUSTMENT: 'ADJUSTMENT',
    RESERVATION: 'RESERVATION',
    RELEASE: 'RELEASE',
    SALE: 'SALE',
    RETURN: 'RETURN',
} as const;

export type InventoryMovementType = (typeof InventoryMovementType)[keyof typeof InventoryMovementType];
