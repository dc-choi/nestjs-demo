import type { CanonicalProductSearchInput, SearchSortValue } from '~/api/catalog/search/domain/product-search.query';

export const PRODUCT_SEARCH_PORT = Symbol('PRODUCT_SEARCH_PORT');
export const PRODUCT_SEARCH_CURSOR_SECRET = Symbol('PRODUCT_SEARCH_CURSOR_SECRET');

export interface ProductSearchPort {
    isAvailable(): boolean;
    /**
     * Opens a session when sessionId is null and returns the latest session ID on success.
     * Failures must close newly opened sessions and replacement IDs that cannot be returned.
     * Request failures before a replacement ID arrives preserve the caller's existing session.
     * Backend failures become ProductSearchUnavailableError; expired sessions become ProductSearchCursorExpiredError.
     * The caller closes successful terminal pages and sessions whose continuation cursor cannot be returned.
     */
    search(request: ProductSearchBackendRequest): Promise<ProductSearchPage>;
    /** Best-effort cleanup. Implementations must not throw when a backend rejects cleanup. */
    close(sessionId: string): Promise<void>;
}

export interface ProductSearchBackendRequest {
    readonly input: CanonicalProductSearchInput;
    readonly sessionId: string | null;
    readonly searchAfter: readonly SearchSortValue[] | null;
}

interface ProductSearchPageBase {
    readonly sessionId: string;
    readonly nodes: readonly ProductSearchNode[];
}

export interface ProductSearchTerminalPage extends ProductSearchPageBase {
    readonly hasNextPage: false;
    readonly nextSortValues: null;
}

export interface ProductSearchContinuationPage extends ProductSearchPageBase {
    readonly hasNextPage: true;
    readonly nextSortValues: readonly SearchSortValue[];
}

export type ProductSearchPage = ProductSearchTerminalPage | ProductSearchContinuationPage;

export interface ProductSearchNode {
    readonly productId: string;
    readonly slug: string;
    readonly name: string;
    readonly itemId: string;
    readonly itemName: string;
    readonly price: {
        readonly amount: string;
        readonly currencyCode: string;
    };
    readonly thumbnail: null;
}

export interface ProductSearchConnection {
    readonly nodes: readonly ProductSearchNode[];
    readonly pageInfo: {
        readonly hasNextPage: boolean;
        readonly endCursor: string | null;
    };
}

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

export class ProductSearchCursorExpiredError extends Error {
    constructor() {
        super('Search cursor has expired');
        this.name = ProductSearchCursorExpiredError.name;
    }
}
