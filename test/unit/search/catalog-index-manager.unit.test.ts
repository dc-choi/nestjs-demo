import { type Mock, describe, expect, it, vi } from 'vitest';
import { catalogIndexDefinition, catalogNoriIndexDefinition } from '~/infra/search/catalog-index.definition';
import { CatalogBulkError, CatalogIndexManager } from '~/infra/search/catalog-index.manager';
import { OpenSearchHttpClient, OpenSearchHttpError } from '~/infra/search/opensearch.client';
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
        const request = vi.fn().mockResolvedValue({
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
        const request = vi
            .fn()
            .mockResolvedValueOnce({ old: { aliases: { 'catalog-products-read': {} } } })
            .mockResolvedValueOnce({ old: { aliases: { 'catalog-products-write': { is_write_index: true } } } })
            .mockResolvedValueOnce({ acknowledged: true });
        const manager = createManager(request);

        await manager.cutOverAliases('new-index');

        expect(request).toHaveBeenLastCalledWith('POST', '/_aliases', {
            body: {
                actions: [
                    { remove: { index: 'old', alias: 'catalog-products-read', must_exist: true } },
                    { remove: { index: 'old', alias: 'catalog-products-write', must_exist: true } },
                    { add: { index: 'new-index', alias: 'catalog-products-read' } },
                    { add: { index: 'new-index', alias: 'catalog-products-write', is_write_index: true } },
                ],
            },
        });
    });

    it('does not adopt successor aliases when completing a rebuild with a captured target', async () => {
        const request = vi.fn().mockRejectedValue(new Error('expected alias no longer exists'));
        const manager = createManager(request);

        await expect(manager.cutOverAliases('stale-index', { read: ['old'], write: ['old'] })).rejects.toThrow(
            'expected alias no longer exists'
        );
        expect(request).toHaveBeenCalledTimes(1);
        expect(request.mock.calls[0].slice(0, 2)).toEqual(['POST', '/_aliases']);
    });

    it('uses external_gte only for an explicit equal-version repair', async () => {
        const request = vi.fn().mockResolvedValue({
            errors: false,
            items: [{ index: { _id: '1', status: 200 } }],
        });
        const manager = createManager(request);

        await manager.repairExternal(createDocument('1'), { indexName: 'old-index', writeAlias: 'old-projection' });

        const options = request.mock.calls[0][2] as { ndjson: string; query: unknown };
        expect(options.query).toEqual({ require_alias: true });
        expect(options.ndjson).toContain('"version_type":"external_gte"');
        expect(options.ndjson).toContain('"_index":"old-projection"');
    });

    it('creates a generation-specific write alias and adopts older indexes without moving it', async () => {
        const request = vi.fn().mockResolvedValue({ acknowledged: true });
        const manager = createManager(request);
        await manager.createIndex('old-index');
        const body = request.mock.calls[0][2].body as { aliases: Record<string, unknown> };
        const writeAlias = Object.keys(body.aliases)[0];
        expect(body.aliases[writeAlias]).toEqual({ is_write_index: true });
        request.mockReset();
        request
            .mockResolvedValueOnce({ 'old-index': {} })
            .mockRejectedValueOnce(new OpenSearchHttpError(404, {}, 'missing'))
            .mockResolvedValueOnce({ acknowledged: true });

        await expect(manager.resolveWriteTarget()).resolves.toEqual({ indexName: 'old-index', writeAlias });
        expect(request).toHaveBeenLastCalledWith('POST', '/_aliases', {
            body: { actions: [{ add: { index: 'old-index', alias: writeAlias, is_write_index: true } }] },
        });
    });

    it('rejects missing or ambiguous active targets and conflicting projection aliases', async () => {
        const request = vi.fn();
        const manager = createManager(request);
        request.mockResolvedValueOnce({});
        await expect(manager.resolveWriteTarget()).rejects.toThrow('exactly one index');
        request.mockResolvedValueOnce({ first: {}, second: {} });
        await expect(manager.resolveWriteTarget()).rejects.toThrow('exactly one index');
        request.mockResolvedValueOnce({ first: {} }).mockResolvedValueOnce({ second: {} });
        await expect(manager.resolveWriteTarget()).rejects.toThrow('does not match');
        expect(request.mock.calls.every(([method]) => method === 'GET')).toBe(true);
    });
});

function createManager(request: Mock): CatalogIndexManager {
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
