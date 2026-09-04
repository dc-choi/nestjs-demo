import { catalogIndexDefinition, catalogNoriIndexDefinition } from '~/infra/search/catalog-index.definition';
import { CatalogBulkError, CatalogIndexManager } from '~/infra/search/catalog-index.manager';
import { OpenSearchHttpClient } from '~/infra/search/opensearch.client';
import { SearchConfig } from '~/infra/search/search.config';

describe('Catalog index manager', () => {
    it('keeps root and item mappings strict and changes only the named analyzer implementation', () => {
        expect(catalogIndexDefinition.mappings.dynamic).toBe('strict');
        expect(catalogIndexDefinition.mappings.properties.items.dynamic).toBe('strict');
        expect(catalogIndexDefinition.mappings.properties.items.type).toBe('nested');
        expect(catalogIndexDefinition.mappings.properties.minPrice.scaling_factor).toBe(1000);
        expect(catalogNoriIndexDefinition.settings.analysis.analyzer.catalog_text_index.tokenizer).toBe(
            'catalog_nori_tokenizer'
        );
    });

    it('uses external product revision and validates every Bulk item', async () => {
        const request = jest.fn().mockResolvedValue({
            errors: true,
            items: [
                { index: { _id: '1', status: 201 } },
                { index: { _id: '2', status: 400, error: { type: 'strict_dynamic_mapping_exception' } } },
            ],
        });
        const manager = createManager(request);

        await expect(
            manager.bulkIndex('catalog-products-v001-build', [createDocument('1'), createDocument('2')])
        ).rejects.toBeInstanceOf(CatalogBulkError);
        const options = request.mock.calls[0][2] as { ndjson: string; query?: unknown };
        expect(options.query).toBeUndefined();
        expect(options.ndjson).toContain('"version":3');
        expect(options.ndjson).toContain('"version_type":"external"');
    });

    it('moves both aliases in one atomic aliases request after resolving current targets', async () => {
        const request = jest
            .fn()
            .mockResolvedValueOnce({ old: { aliases: { 'catalog-products-read': {} } } })
            .mockResolvedValueOnce({ old: { aliases: { 'catalog-products-write': { is_write_index: true } } } })
            .mockResolvedValueOnce({ acknowledged: true });
        const manager = createManager(request);

        await manager.cutOverAliases('new-index');

        expect(request).toHaveBeenLastCalledWith('POST', '/_aliases', {
            body: {
                actions: [
                    { remove: { index: 'old', alias: 'catalog-products-read' } },
                    { remove: { index: 'old', alias: 'catalog-products-write' } },
                    { add: { index: 'new-index', alias: 'catalog-products-read' } },
                    { add: { index: 'new-index', alias: 'catalog-products-write', is_write_index: true } },
                ],
            },
        });
    });

    it('uses external_gte only for an explicit equal-version repair', async () => {
        const request = jest.fn().mockResolvedValue({
            errors: false,
            items: [{ index: { _id: '1', status: 200 } }],
        });
        const manager = createManager(request);

        await manager.repairExternal(createDocument('1'));

        const options = request.mock.calls[0][2] as { ndjson: string; query: unknown };
        expect(options.query).toEqual({ require_alias: true });
        expect(options.ndjson).toContain('"version_type":"external_gte"');
    });
});

function createManager(request: jest.Mock): CatalogIndexManager {
    const client = { request } as unknown as OpenSearchHttpClient;
    const config = {
        readAlias: 'catalog-products-read',
        writeAlias: 'catalog-products-write',
    } as SearchConfig;
    return new CatalogIndexManager(client, config);
}

function createDocument(productId: string) {
    return {
        schemaVersion: 1 as const,
        productId,
        productRevision: 3,
        sellerId: '10',
        slug: `product-${productId}`,
        updatedAt: '2026-08-12T10:00:00.000Z',
        name: '상품',
        description: '',
        tags: [],
        categoryIds: [],
        categorySlugs: [],
        categoryNames: [],
        categoryAncestorSlugs: [],
        thumbnail: null,
        minPrice: 1,
        maxPrice: 1,
        items: [
            {
                itemId: productId,
                sku: `sku-${productId}`,
                name: '기본',
                sequence: 0,
                totalPrice: 1,
                isTaxFree: false,
                optionTokens: [],
            },
        ],
    };
}
