export const SearchProjectionOutboxStatus = {
    PENDING: 'PENDING',
    PROCESSING: 'PROCESSING',
    PROCESSED: 'PROCESSED',
    DEAD_LETTER: 'DEAD_LETTER',
} as const;

export type SearchProjectionOutboxStatus =
    (typeof SearchProjectionOutboxStatus)[keyof typeof SearchProjectionOutboxStatus];
