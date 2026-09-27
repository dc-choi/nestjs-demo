export const OrderAddressType = {
    BILLING: 'BILLING',
    SHIPPING: 'SHIPPING',
} as const;

export type OrderAddressType = (typeof OrderAddressType)[keyof typeof OrderAddressType];
