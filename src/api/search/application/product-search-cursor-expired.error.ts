export class ProductSearchCursorExpiredError extends Error {
    constructor() {
        super('Search cursor has expired');
        this.name = ProductSearchCursorExpiredError.name;
    }
}
