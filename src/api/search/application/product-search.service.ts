import { Inject, Injectable } from '@nestjs/common';

import { PRODUCT_SEARCH_CURSOR_SECRET } from '~/api/search/application/product-search-cursor-secret.js';
import { ProductSearchCursorError } from '~/api/search/application/product-search-cursor.error.js';
import {
    assertSearchCursorFingerprint,
    decodeSearchCursor,
    encodeSearchCursor,
} from '~/api/search/application/product-search-cursor.js';
import { ProductSearchSessionExpiredError } from '~/api/search/application/product-search-session-expired.error.js';
import { ProductSearchUnavailableError } from '~/api/search/application/product-search-unavailable.error.js';
import {
    PRODUCT_SEARCH_PORT,
    type ProductSearchNode,
    type ProductSearchPort,
} from '~/api/search/application/product-search.port.js';
import {
    ProductSearchInput,
    canonicalizeProductSearchInput,
    fingerprintProductSearchInput,
} from '~/api/search/domain/product-search.query.js';

export interface ProductSearchConnection {
    readonly nodes: readonly ProductSearchNode[];
    readonly pageInfo: {
        readonly hasNextPage: boolean;
        readonly endCursor: string | null;
    };
}

@Injectable()
export class ProductSearchService {
    constructor(
        @Inject(PRODUCT_SEARCH_PORT)
        private readonly searchPort: ProductSearchPort,
        @Inject(PRODUCT_SEARCH_CURSOR_SECRET)
        private readonly cursorSecret: string
    ) {}

    async search(input: ProductSearchInput): Promise<ProductSearchConnection> {
        if (!this.searchPort.isAvailable()) {
            throw new ProductSearchUnavailableError('SEARCH_DISABLED', 'Product search is disabled');
        }
        const canonical = canonicalizeProductSearchInput(input);
        const fingerprint = fingerprintProductSearchInput(canonical);
        const cursor = input.after ? decodeSearchCursor(input.after, this.cursorSecret) : null;
        if (cursor) assertSearchCursorFingerprint(cursor, fingerprint);

        let page;
        try {
            page = await this.searchPort.search({
                input: canonical,
                sessionId: cursor?.sessionId ?? null,
                searchAfter: cursor?.sortValues ?? null,
            });
        } catch (error) {
            if (error instanceof ProductSearchSessionExpiredError) {
                throw new ProductSearchCursorError('SEARCH_CURSOR_EXPIRED', { cause: error });
            }
            throw error;
        }

        if (!page.hasNextPage) {
            await this.searchPort.close(page.sessionId);
            return { nodes: page.nodes, pageInfo: { hasNextPage: false, endCursor: null } };
        }

        try {
            return {
                nodes: page.nodes,
                pageInfo: {
                    hasNextPage: true,
                    endCursor: encodeSearchCursor(
                        page.sessionId,
                        [...page.nextSortValues],
                        fingerprint,
                        this.cursorSecret
                    ),
                },
            };
        } catch (error) {
            await this.searchPort.close(page.sessionId);
            throw error;
        }
    }
}
