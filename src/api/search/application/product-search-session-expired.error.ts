export class ProductSearchSessionExpiredError extends Error {
    constructor() {
        super('Search session has expired');
        this.name = ProductSearchSessionExpiredError.name;
    }
}
