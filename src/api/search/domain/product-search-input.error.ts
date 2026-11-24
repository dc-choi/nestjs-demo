export class ProductSearchInputError extends Error {
    readonly code = 'INVALID_SEARCH_INPUT';

    constructor(message: string) {
        super(message);
        this.name = ProductSearchInputError.name;
    }
}
