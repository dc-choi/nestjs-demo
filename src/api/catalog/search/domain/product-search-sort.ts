export const ProductSearchSort = {
    RELEVANCE: 'RELEVANCE',
    PRICE_ASC: 'PRICE_ASC',
    PRICE_DESC: 'PRICE_DESC',
} as const;

export type ProductSearchSort = (typeof ProductSearchSort)[keyof typeof ProductSearchSort];
