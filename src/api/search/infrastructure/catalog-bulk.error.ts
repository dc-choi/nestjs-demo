export interface CatalogBulkFailure {
    documentId: string;
    status: number;
    error: unknown;
}

export class CatalogBulkError extends Error {
    constructor(readonly failures: CatalogBulkFailure[]) {
        super(`OpenSearch Bulk failed for ${failures.length} catalog document(s)`);
        this.name = CatalogBulkError.name;
    }
}
