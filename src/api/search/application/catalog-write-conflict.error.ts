/**
 * OpenSearch rejected an external-version write because of the stored version or a missing target.
 * The index may already hold the desired state, so the caller re-reads the document instead of retrying.
 */
export class CatalogWriteConflictError extends Error {
    constructor(options?: ErrorOptions) {
        super('OpenSearch rejected an external-version catalog write', options);
        this.name = CatalogWriteConflictError.name;
    }
}
