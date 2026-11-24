export const CatalogAnalyzer = {
    STANDARD: 'standard',
    NORI: 'nori',
} as const;

export type CatalogAnalyzer = (typeof CatalogAnalyzer)[keyof typeof CatalogAnalyzer];
