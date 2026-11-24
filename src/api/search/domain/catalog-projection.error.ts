export class CatalogProjectionError extends Error {
    constructor(message: string) {
        super(message);
        this.name = CatalogProjectionError.name;
    }
}
