import type { CanonicalProductSearchInput, SearchSortValue } from '~/api/catalog/search/domain/product-search.query';

export const PRODUCT_SEARCH_PORT = Symbol('PRODUCT_SEARCH_PORT');
export const PRODUCT_SEARCH_CURSOR_SECRET = Symbol('PRODUCT_SEARCH_CURSOR_SECRET');

export interface ProductSearchPort {
    isAvailable(): boolean;
    search(request: ProductSearchBackendRequest): Promise<ProductSearchPage>;
    close(sessionId: string): Promise<void>;
}

export interface ProductSearchBackendRequest {
    readonly input: CanonicalProductSearchInput;
    readonly sessionId: string | null;
    readonly searchAfter: readonly SearchSortValue[] | null;
}

export interface ProductSearchPage {
    readonly sessionId: string;
    readonly nodes: readonly ProductSearchNode[];
    readonly hasNextPage: boolean;
    readonly nextSortValues: readonly SearchSortValue[] | null;
}

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
