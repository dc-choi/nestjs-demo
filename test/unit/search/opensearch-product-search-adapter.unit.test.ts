import { describe, expect, it, vi } from 'vitest';
import { ProductSearchSessionExpiredError } from '~/api/search/application/product-search-session-expired.error.js';
import { ProductSearchUnavailableError } from '~/api/search/application/product-search-unavailable.error.js';
import { ProductSearchBackendRequest } from '~/api/search/application/product-search.port.js';
import { canonicalizeProductSearchInput } from '~/api/search/domain/product-search.query.js';
import { OpenSearchProductSearchAdapter } from '~/api/search/infrastructure/opensearch-product-search.adapter.js';
import { OpenSearchHttpError } from '~/infra/opensearch/opensearch-http.error.js';
import { OpenSearchHttpClient } from '~/infra/opensearch/opensearch.client.js';
import { OpenSearchConfig } from '~/infra/opensearch/opensearch.config.js';

describe('OpenSearch product search adapter', () => {
    it('does not call OpenSearch when search is disabled', async () => {
        const request = vi.fn();
        const adapter = new OpenSearchProductSearchAdapter(
            { enabled: false } as OpenSearchConfig,
            { request } as unknown as OpenSearchHttpClient
        );

        await expect(adapter.search(searchRequest())).rejects.toMatchObject({
            code: 'SEARCH_DISABLED',
            message: 'Product search is disabled',
        });
        expect(request).not.toHaveBeenCalled();
    });

    it('opens a PIT, translates the query, and parses search hits', async () => {
        const request = vi
            .fn()
            .mockResolvedValueOnce({ pit_id: 'pit-1' })
            .mockResolvedValueOnce({
                pit_id: 'pit-2',
                hits: {
                    hits: [
                        {
                            _source: { productId: '1', slug: 'keyboard', name: '키보드' },
                            sort: ['1'],
                            inner_hits: {
                                selected_item: {
                                    hits: {
                                        hits: [
                                            {
                                                _source: { itemId: '11', name: '검정', totalPrice: 1234.5 },
                                            },
                                        ],
                                    },
                                },
                            },
                        },
                    ],
                },
            });
        const adapter = new OpenSearchProductSearchAdapter(
            { enabled: true, readAlias: 'catalog-products-read' } as OpenSearchConfig,
            { request } as unknown as OpenSearchHttpClient
        );

        await expect(adapter.search(searchRequest())).resolves.toEqual({
            sessionId: 'pit-2',
            nodes: [
                {
                    productId: '1',
                    slug: 'keyboard',
                    name: '키보드',
                    itemId: '11',
                    itemName: '검정',
                    price: 1234.5,
                },
            ],
            hasNextPage: false,
            nextSortValues: null,
        });
        expect(request).toHaveBeenNthCalledWith(1, 'POST', '/catalog-products-read/_search/point_in_time', {
            query: { keep_alive: '1m' },
        });
        expect(request).toHaveBeenNthCalledWith(
            2,
            'POST',
            '/_search',
            expect.objectContaining({
                query: { allow_partial_search_results: false },
                body: expect.objectContaining({ pit: { id: 'pit-1', keep_alive: '1m' } }),
            })
        );
    });

    it.each([
        ['timeout', { timed_out: true }],
        ['failed shard', { _shards: { failed: 1 } }],
    ])('rejects a %s response and closes its rotated PIT', async (_, incomplete) => {
        const request = vi
            .fn()
            .mockResolvedValueOnce({ pit_id: 'pit-1' })
            .mockResolvedValueOnce({ pit_id: 'pit-2', hits: { hits: [] }, ...incomplete })
            .mockResolvedValueOnce(null);
        const adapter = new OpenSearchProductSearchAdapter(
            { enabled: true, readAlias: 'catalog-products-read' } as OpenSearchConfig,
            { request } as unknown as OpenSearchHttpClient
        );

        await expect(adapter.search(searchRequest())).rejects.toMatchObject({ code: 'SEARCH_UNAVAILABLE' });
        expect(request).toHaveBeenLastCalledWith('DELETE', '/_search/point_in_time', { body: { pit_id: 'pit-2' } });
    });

    it('keeps a caller-owned PIT available after an incomplete response', async () => {
        const request = vi.fn().mockResolvedValue({ timed_out: true, hits: { hits: [] } });
        const adapter = new OpenSearchProductSearchAdapter(
            { enabled: true, readAlias: 'catalog-products-read' } as OpenSearchConfig,
            { request } as unknown as OpenSearchHttpClient
        );

        await expect(adapter.search({ ...searchRequest(), sessionId: 'cursor-pit' })).rejects.toMatchObject({
            code: 'SEARCH_UNAVAILABLE',
        });
        expect(request).toHaveBeenCalledTimes(1);
    });

    it('converts unavailable backend errors to an application port error', async () => {
        const adapter = new OpenSearchProductSearchAdapter(
            { enabled: true, readAlias: 'catalog-products-read' } as OpenSearchConfig,
            { request: vi.fn().mockRejectedValue(new Error('offline')) } as unknown as OpenSearchHttpClient
        );

        await expect(adapter.search(searchRequest())).rejects.toBeInstanceOf(ProductSearchUnavailableError);
    });

    it('closes a newly opened PIT when the search request fails', async () => {
        const request = vi
            .fn()
            .mockResolvedValueOnce({ pit_id: 'pit-1' })
            .mockRejectedValueOnce(new Error('offline'))
            .mockResolvedValueOnce(null);
        const adapter = new OpenSearchProductSearchAdapter(
            { enabled: true, readAlias: 'catalog-products-read' } as OpenSearchConfig,
            { request } as unknown as OpenSearchHttpClient
        );

        await expect(adapter.search(searchRequest())).rejects.toBeInstanceOf(ProductSearchUnavailableError);
        expect(request).toHaveBeenLastCalledWith('DELETE', '/_search/point_in_time', { body: { pit_id: 'pit-1' } });
    });

    it('closes the latest newly opened PIT when response decoding fails', async () => {
        const request = vi
            .fn()
            .mockResolvedValueOnce({ pit_id: 'pit-1' })
            .mockResolvedValueOnce({ pit_id: 'pit-2', hits: { hits: [{ _source: { productId: 1 } }] } })
            .mockResolvedValueOnce(null);
        const adapter = new OpenSearchProductSearchAdapter(
            { enabled: true, readAlias: 'catalog-products-read' } as OpenSearchConfig,
            { request } as unknown as OpenSearchHttpClient
        );

        await expect(adapter.search(searchRequest())).rejects.toBeInstanceOf(ProductSearchUnavailableError);
        expect(request).toHaveBeenLastCalledWith('DELETE', '/_search/point_in_time', { body: { pit_id: 'pit-2' } });
    });

    it('reports an expired caller-owned PIT as an expired session without closing it', async () => {
        const request = vi
            .fn()
            .mockRejectedValue(
                new OpenSearchHttpError(404, { error: { type: 'search_context_missing_exception' } }, 'expired')
            );
        const adapter = new OpenSearchProductSearchAdapter(
            { enabled: true, readAlias: 'catalog-products-read' } as OpenSearchConfig,
            { request } as unknown as OpenSearchHttpClient
        );

        await expect(adapter.search({ ...searchRequest(), sessionId: 'cursor-pit' })).rejects.toBeInstanceOf(
            ProductSearchSessionExpiredError
        );
        expect(request).toHaveBeenCalledTimes(1);
    });

    it('does not close a caller-owned PIT after a retriable search failure', async () => {
        const request = vi.fn().mockRejectedValue(new Error('offline'));
        const adapter = new OpenSearchProductSearchAdapter(
            { enabled: true, readAlias: 'catalog-products-read' } as OpenSearchConfig,
            { request } as unknown as OpenSearchHttpClient
        );

        await expect(adapter.search({ ...searchRequest(), sessionId: 'cursor-pit' })).rejects.toBeInstanceOf(
            ProductSearchUnavailableError
        );
        expect(request).toHaveBeenCalledTimes(1);
    });

    it('closes a rotated continuation PIT when decoding fails before its ID can be returned', async () => {
        const request = vi
            .fn()
            .mockResolvedValueOnce({ pit_id: 'rotated-pit', hits: { hits: [{ _source: { productId: 1 } }] } })
            .mockResolvedValueOnce(null);
        const adapter = new OpenSearchProductSearchAdapter(
            { enabled: true, readAlias: 'catalog-products-read' } as OpenSearchConfig,
            { request } as unknown as OpenSearchHttpClient
        );

        await expect(adapter.search({ ...searchRequest(), sessionId: 'cursor-pit' })).rejects.toBeInstanceOf(
            ProductSearchUnavailableError
        );
        expect(request).toHaveBeenLastCalledWith('DELETE', '/_search/point_in_time', {
            body: { pit_id: 'rotated-pit' },
        });
    });

    it('does not parse the extra sentinel hit', async () => {
        const request = vi
            .fn()
            .mockResolvedValueOnce({ pit_id: 'pit-1' })
            .mockResolvedValueOnce({
                hits: {
                    hits: [productHit({ productId: '1', itemId: '11', sort: ['1'] }), { _source: { productId: 2 } }],
                },
            });
        const adapter = new OpenSearchProductSearchAdapter(
            { enabled: true, readAlias: 'catalog-products-read' } as OpenSearchConfig,
            { request } as unknown as OpenSearchHttpClient
        );

        await expect(
            adapter.search({ ...searchRequest(), input: canonicalizeProductSearchInput({ first: 1 }) })
        ).resolves.toMatchObject({
            nodes: [expect.objectContaining({ productId: '1' })],
            hasNextPage: true,
            nextSortValues: ['1'],
        });
    });
});

describe('OpenSearch product ID search for relevance evaluation', () => {
    it('reads top product IDs from an explicit alias without partial results and closes the PIT', async () => {
        const request = vi
            .fn()
            .mockResolvedValueOnce({ pit_id: 'pit-1' })
            .mockResolvedValueOnce({ pit_id: 'pit-2', hits: { hits: [{ _id: '3' }, { _id: '1' }] } })
            .mockResolvedValueOnce(null);
        const adapter = new OpenSearchProductSearchAdapter(
            { enabled: true, readAlias: 'catalog-products-read' } as OpenSearchConfig,
            { request } as unknown as OpenSearchHttpClient
        );

        await expect(
            adapter.searchProductIds('candidate-alias', canonicalizeProductSearchInput({ query: '키보드', first: 10 }))
        ).resolves.toEqual(['3', '1']);
        expect(request).toHaveBeenNthCalledWith(1, 'POST', '/candidate-alias/_search/point_in_time', {
            query: { keep_alive: '1m' },
        });
        expect(request).toHaveBeenNthCalledWith(
            2,
            'POST',
            '/_search',
            expect.objectContaining({
                query: { allow_partial_search_results: false },
                body: expect.objectContaining({ size: 10, _source: false, pit: { id: 'pit-1', keep_alive: '1m' } }),
            })
        );
        expect(request).toHaveBeenLastCalledWith('DELETE', '/_search/point_in_time', { body: { pit_id: 'pit-2' } });
    });

    it.each([
        ['timeout', { timed_out: true }],
        ['failed shard', { _shards: { failed: 1 } }],
    ])('rejects a %s response and closes its rotated PIT', async (_, incomplete) => {
        const request = vi
            .fn()
            .mockResolvedValueOnce({ pit_id: 'pit-1' })
            .mockResolvedValueOnce({ pit_id: 'pit-2', hits: { hits: [{ _id: '1' }] }, ...incomplete })
            .mockResolvedValueOnce(null);
        const adapter = new OpenSearchProductSearchAdapter(
            { enabled: true, readAlias: 'catalog-products-read' } as OpenSearchConfig,
            { request } as unknown as OpenSearchHttpClient
        );

        await expect(
            adapter.searchProductIds('candidate-alias', canonicalizeProductSearchInput({ first: 10 }))
        ).rejects.toThrow('incomplete');
        expect(request).toHaveBeenLastCalledWith('DELETE', '/_search/point_in_time', { body: { pit_id: 'pit-2' } });
    });
});

function productHit({ productId, itemId, sort }: { productId: string; itemId: string; sort: string[] }) {
    return {
        _source: { productId, slug: 'keyboard', name: '키보드' },
        sort,
        inner_hits: {
            selected_item: {
                hits: {
                    hits: [{ _source: { itemId, name: '검정', totalPrice: 1234.5 } }],
                },
            },
        },
    };
}

function searchRequest(): ProductSearchBackendRequest {
    return {
        input: canonicalizeProductSearchInput({ first: 2 }),
        sessionId: null,
        searchAfter: null,
    };
}
