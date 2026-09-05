import { describe, expect, it, vi } from 'vitest';
import {
    ProductSearchBackendRequest,
    ProductSearchUnavailableError,
} from '~/api/catalog/search/application/product-search.port';
import { canonicalizeProductSearchInput } from '~/api/catalog/search/domain/product-search.query';
import { OpenSearchProductSearchAdapter } from '~/infra/search/opensearch-product-search.adapter';
import { OpenSearchHttpClient } from '~/infra/search/opensearch.client';
import { SearchConfig } from '~/infra/search/search.config';

describe('OpenSearch product search adapter', () => {
    it('does not call OpenSearch when search is disabled', async () => {
        const request = vi.fn();
        const adapter = new OpenSearchProductSearchAdapter(
            { enabled: false } as SearchConfig,
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
            { enabled: true, readAlias: 'catalog-products-read' } as SearchConfig,
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
                    price: { amount: '1234.500', currencyCode: 'KRW' },
                    thumbnail: null,
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
            expect.objectContaining({ body: expect.objectContaining({ pit: { id: 'pit-1', keep_alive: '1m' } }) })
        );
    });

    it('converts unavailable backend errors to an application port error', async () => {
        const adapter = new OpenSearchProductSearchAdapter(
            { enabled: true, readAlias: 'catalog-products-read' } as SearchConfig,
            { request: vi.fn().mockRejectedValue(new Error('offline')) } as unknown as OpenSearchHttpClient
        );

        await expect(adapter.search(searchRequest())).rejects.toBeInstanceOf(ProductSearchUnavailableError);
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
            { enabled: true, readAlias: 'catalog-products-read' } as SearchConfig,
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
