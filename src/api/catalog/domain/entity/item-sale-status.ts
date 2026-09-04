export const ItemSaleStatus = {
    ALLOW: 'ALLOW',
    DENY: 'DENY',
} as const;

export type ItemSaleStatus = (typeof ItemSaleStatus)[keyof typeof ItemSaleStatus];
