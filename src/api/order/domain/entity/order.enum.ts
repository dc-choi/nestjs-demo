export const OrderStatus = {
    PENDING: 'PENDING',
    CONFIRMED: 'CONFIRMED',
    CANCELLED: 'CANCELLED',
    COMPLETED: 'COMPLETED',
} as const;

export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];

export const OrderAddressType = {
    BILLING: 'BILLING',
    SHIPPING: 'SHIPPING',
} as const;

export type OrderAddressType = (typeof OrderAddressType)[keyof typeof OrderAddressType];

export const OrderActorType = {
    MEMBER: 'MEMBER',
    SYSTEM: 'SYSTEM',
    PROVIDER: 'PROVIDER',
} as const;

export type OrderActorType = (typeof OrderActorType)[keyof typeof OrderActorType];
