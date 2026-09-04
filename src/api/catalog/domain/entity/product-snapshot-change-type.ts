export const ProductSnapshotChangeType = {
    CREATE: 'CREATE',
    UPDATE: 'UPDATE',
    RESTORE: 'RESTORE',
    DELETE: 'DELETE',
} as const;

export type ProductSnapshotChangeType = (typeof ProductSnapshotChangeType)[keyof typeof ProductSnapshotChangeType];
