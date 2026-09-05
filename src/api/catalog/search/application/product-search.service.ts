import { Inject, Injectable } from '@nestjs/common';

import {
    PRODUCT_SEARCH_CURSOR_SECRET,
    PRODUCT_SEARCH_PORT,
    ProductSearchConnection,
    ProductSearchCursorExpiredError,
    ProductSearchPort,
    ProductSearchUnavailableError,
} from '~/api/catalog/search/application/product-search.port';
import {
    ProductSearchContractError,
    ProductSearchInput,
    assertSearchCursorFingerprint,
    canonicalizeProductSearchInput,
    decodeSearchCursor,
    encodeSearchCursor,
    fingerprintProductSearchInput,
} from '~/api/catalog/search/domain/product-search.query';

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
                sessionId: cursor?.pitId ?? null,
                searchAfter: cursor?.sortValues ?? null,
            });
        } catch (error) {
            if (error instanceof ProductSearchCursorExpiredError) {
                throw new ProductSearchContractError('SEARCH_CURSOR_EXPIRED', error.message);
            }
            throw error;
        }

        if (!page.hasNextPage) {
            await this.searchPort.close(page.sessionId);
            return { nodes: page.nodes, pageInfo: { hasNextPage: false, endCursor: null } };
        }

        if (!page.nextSortValues) throw new Error('Product search page is missing cursor sort values');
        return {
            nodes: page.nodes,
            pageInfo: {
                hasNextPage: true,
                endCursor: encodeSearchCursor(page.sessionId, [...page.nextSortValues], fingerprint, this.cursorSecret),
            },
        };
    }
}
