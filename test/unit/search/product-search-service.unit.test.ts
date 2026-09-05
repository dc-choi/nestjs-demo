import { describe, expect, it, vi } from 'vitest';
import type { ProductSearchNode } from '~/api/catalog/search/application/product-search.port';
import { ProductSearchService } from '~/api/catalog/search/application/product-search.service';

describe('Product search service', () => {
    it('reports a disabled search before validating the request', async () => {
        const search = vi.fn();
        const service = new ProductSearchService({ isAvailable: () => false, search, close: vi.fn() }, 'test-secret');

        await expect(service.search({ first: 0 })).rejects.toMatchObject({ code: 'SEARCH_DISABLED' });
        expect(search).not.toHaveBeenCalled();
    });

    it('owns terminal-page cursor lifecycle while the port supplies search results', async () => {
        const search = vi.fn().mockResolvedValue({
            sessionId: 'session-2',
            nodes: [node('1', '11')],
            hasNextPage: false,
            nextSortValues: null,
        });
        const close = vi.fn().mockResolvedValue(undefined);
        const service = new ProductSearchService({ isAvailable: () => true, search, close }, 'test-secret');

        await expect(service.search({ first: 2 })).resolves.toEqual({
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
        expect(search).toHaveBeenCalledWith(
            expect.objectContaining({
                sessionId: null,
                searchAfter: null,
                input: expect.objectContaining({ first: 2 }),
            })
        );
        expect(close).toHaveBeenCalledWith('session-2');
    });

    it('signs the next cursor using the port PIT and sort values', async () => {
        const search = vi.fn().mockResolvedValue({
            sessionId: 'session-1',
            nodes: [node('1', '11'), node('2', '12')],
            hasNextPage: true,
            nextSortValues: ['1'],
        });
        const close = vi.fn();
        const service = new ProductSearchService({ isAvailable: () => true, search, close }, 'test-secret');

        const result = await service.search({ first: 1 });

        expect(result.pageInfo).toMatchObject({ hasNextPage: true, endCursor: expect.any(String) });
        expect(close).not.toHaveBeenCalled();
    });
});

function node(productId: string, itemId: string): ProductSearchNode {
    return {
        productId,
        slug: 'keyboard',
        name: '키보드',
        itemId,
        itemName: '검정',
        price: { amount: '1234.500', currencyCode: 'KRW' },
        thumbnail: null,
    };
}
