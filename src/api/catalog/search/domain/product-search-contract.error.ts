export class ProductSearchContractError extends Error {
    constructor(
        readonly code:
            | 'INVALID_SEARCH_INPUT'
            | 'INVALID_SEARCH_CURSOR'
            | 'SEARCH_CURSOR_EXPIRED'
            | 'SEARCH_CURSOR_MISMATCH',
        message: string
    ) {
        super(message);
        this.name = ProductSearchContractError.name;
    }
}
