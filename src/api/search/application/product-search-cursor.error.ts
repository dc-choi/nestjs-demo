const MESSAGES = {
    INVALID_SEARCH_CURSOR: 'Search cursor is invalid',
    SEARCH_CURSOR_EXPIRED: 'Search cursor has expired',
    SEARCH_CURSOR_MISMATCH: 'Search cursor does not match the current search input',
} as const;

export class ProductSearchCursorError extends Error {
    constructor(
        readonly code: keyof typeof MESSAGES,
        options?: ErrorOptions
    ) {
        super(MESSAGES[code], options);
        this.name = ProductSearchCursorError.name;
    }
}
