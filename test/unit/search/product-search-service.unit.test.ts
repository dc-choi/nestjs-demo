import { ProductSearchService } from '~/api/catalog/search/application/product-search.service';
import { OpenSearchHttpClient } from '~/infra/search/opensearch.client';
import { SearchConfig } from '~/infra/search/search.config';

describe('Product search service', () => {
    it('does not call OpenSearch when the feature is disabled', async () => {
        const request = jest.fn();
        const service = createService(false, request);

        await expect(service.search({})).rejects.toMatchObject({ status: 503 });
        expect(request).not.toHaveBeenCalled();
    });

    it('maps a terminal PIT page and closes the PIT', async () => {
        const request = jest
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
                                                _source: {
                                                    itemId: '11',
                                                    name: '검정',
                                                    totalPrice: 1234.5,
                                                },
                                            },
                                        ],
                                    },
                                },
                            },
                        },
                    ],
                },
            })
            .mockResolvedValueOnce({ succeeded: true });
        const service = createService(true, request);

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
        expect(request).toHaveBeenLastCalledWith('DELETE', '/_search/point_in_time', {
            body: { pit_id: 'pit-2' },
        });
    });
});

function createService(enabled: boolean, request: jest.Mock): ProductSearchService {
    const config = {
        enabled,
        readAlias: 'catalog-products-read',
        cursorSecret: 'test-secret',
    } as SearchConfig;
    return new ProductSearchService(config, { request } as unknown as OpenSearchHttpClient);
}
