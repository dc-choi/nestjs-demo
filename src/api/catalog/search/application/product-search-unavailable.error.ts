export class ProductSearchUnavailableError extends Error {
    constructor(
        readonly code: 'SEARCH_DISABLED' | 'SEARCH_UNAVAILABLE' = 'SEARCH_UNAVAILABLE',
        message = 'Product search is temporarily unavailable',
        options?: ErrorOptions
    ) {
        super(message, options);
        this.name = ProductSearchUnavailableError.name;
    }
}
