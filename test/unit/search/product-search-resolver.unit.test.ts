import { describe, expect, it, vi } from 'vitest';
import { ProductSearchCursorError } from '~/api/search/application/product-search-cursor.error.js';
import { ProductSearchService } from '~/api/search/application/product-search.service.js';
import { ProductSearchInputError } from '~/api/search/domain/product-search-input.error.js';
import { ProductSearchResolver } from '~/api/search/presentation/product-search.resolver.js';

describe('Product search resolver', () => {
    it('composes the public Money and hides thumbnails', async () => {
        const search = vi.fn().mockResolvedValue({
            nodes: [
                { productId: '1', slug: 'keyboard', name: '키보드', itemId: '11', itemName: '검정', price: 1234.5 },
            ],
            pageInfo: { hasNextPage: false, endCursor: null },
        });
        const resolver = new ProductSearchResolver({ search } as unknown as ProductSearchService);

        await expect(resolver.searchProducts({})).resolves.toEqual({
            nodes: [
                {
                    productId: '1',
                    slug: 'keyboard',
                    name: '키보드',
                    itemId: '11',
                    itemName: '검정',
                    price: { amount: '1234.500', currencyCode: 'KRW' },
                    thumbnail: null,
                },
            ],
            pageInfo: { hasNextPage: false, endCursor: null },
        });
    });

    it.each([
        [new ProductSearchInputError('first must be between 1 and 50'), 'INVALID_SEARCH_INPUT'],
        [new ProductSearchCursorError('INVALID_SEARCH_CURSOR'), 'INVALID_SEARCH_CURSOR'],
        [new ProductSearchCursorError('SEARCH_CURSOR_EXPIRED'), 'SEARCH_CURSOR_EXPIRED'],
        [new ProductSearchCursorError('SEARCH_CURSOR_MISMATCH'), 'SEARCH_CURSOR_MISMATCH'],
    ])('maps %s to a 400 response with code %s', async (error, code) => {
        const search = vi.fn().mockRejectedValue(error);
        const resolver = new ProductSearchResolver({ search } as unknown as ProductSearchService);

        await expect(resolver.searchProducts({})).rejects.toMatchObject({
            status: 400,
            response: { type: code, message: error.message },
        });
    });
});
