export const SearchReconciliationDifferenceKind = {
    MISSING: 'MISSING',
    STALE: 'STALE',
    EXTRA: 'EXTRA',
} as const;

export type SearchReconciliationDifferenceKind =
    (typeof SearchReconciliationDifferenceKind)[keyof typeof SearchReconciliationDifferenceKind];
