export const ProductStatus = {
    DRAFT: 'DRAFT',
    ACTIVE: 'ACTIVE',
    PAUSED: 'PAUSED',
    SUSPENDED: 'SUSPENDED',
    CLOSED: 'CLOSED',
} as const;

export type ProductStatus = (typeof ProductStatus)[keyof typeof ProductStatus];
