export const FulfillmentStatus = {
    PENDING: 'PENDING',
    PACKED: 'PACKED',
    SHIPPED: 'SHIPPED',
    DELIVERED: 'DELIVERED',
    CANCELLED: 'CANCELLED',
} as const;

export type FulfillmentStatus = (typeof FulfillmentStatus)[keyof typeof FulfillmentStatus];
