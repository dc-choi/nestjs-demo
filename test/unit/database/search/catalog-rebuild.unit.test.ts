import { jest } from '@jest/globals';

import { CatalogProductProjectionSource } from '~/api/catalog/search/domain/product-search.document';
import { CatalogIndexManager } from '~/infra/search/catalog-index.manager';
import { CatalogProjectionBatch, CatalogProjectionReader } from '~/infra/search/catalog-projection.reader';
import { CatalogRebuildService } from '~/infra/search/catalog-rebuild.service';
import { SearchConfig } from '~/infra/search/search.config';

describe('Catalog rebuild', () => {
    it('validates counts and a sample before moving aliases', async () => {
        const source = createSource();
        const reader = {
            fetchSearchableBatch: jest.fn(
                async (afterId: bigint | null): Promise<CatalogProjectionBatch> =>
                    afterId === null ? { sources: [source], nextCursor: 1n } : { sources: [], nextCursor: null }
            ),
            countSearchableProducts: jest.fn(async () => 1),
        } as unknown as CatalogProjectionReader;
        const calls: string[] = [];
        const indexManager = {
            createIndex: jest.fn(async () => calls.push('create')),
            bulkIndex: jest.fn(async () => calls.push('bulk')),
            refresh: jest.fn(async () => calls.push('refresh')),
            count: jest.fn(async () => 1),
            getDocument: jest.fn(async (_index, id) => ({
                id,
                version: 7,
                source: {
                    schemaVersion: 1,
                    productId: '1',
                    productRevision: 7,
                    sellerId: '2',
                    slug: 'keyboard',
                    updatedAt: '2026-08-12T10:00:00.000Z',
                    name: '키보드',
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
                            itemId: '11',
                            sku: 'sku-1',
                            name: '기본',
                            sequence: 0,
                            totalPrice: 1,
                            isTaxFree: false,
                            optionTokens: [],
                        },
                    ],
                },
            })),
            verifyQueryable: jest.fn(async () => calls.push('verify')),
            cutOverAliases: jest.fn(async () => calls.push('cutover')),
        } as unknown as CatalogIndexManager;
        const service = new CatalogRebuildService({ enabled: true } as SearchConfig, reader, indexManager);

        await expect(service.rebuild({ buildId: 'test' })).resolves.toEqual({
            indexName: 'catalog-products-v001-test',
            indexedDocuments: 1,
            analyzer: 'standard',
            activated: true,
            evaluationAlias: null,
        });
        expect(calls).toEqual(['create', 'bulk', 'refresh', 'verify', 'cutover']);
    });

    it('does not move aliases when Bulk indexing fails', async () => {
        const reader = {
            fetchSearchableBatch: jest.fn(
                async (): Promise<CatalogProjectionBatch> => ({ sources: [createSource()], nextCursor: 1n })
            ),
        } as unknown as CatalogProjectionReader;
        const indexManager = {
            createIndex: jest.fn(),
            bulkIndex: jest.fn(async () => {
                throw new Error('bulk failed');
            }),
            cutOverAliases: jest.fn(),
        } as unknown as CatalogIndexManager;
        const service = new CatalogRebuildService({ enabled: true } as SearchConfig, reader, indexManager);

        await expect(service.rebuild({ buildId: 'failed' })).rejects.toThrow('bulk failed');
        expect(indexManager.cutOverAliases).not.toHaveBeenCalled();
    });

    it.each(['catalog-read', 'catalog-write'])('rejects the active %s alias as an evaluation alias', async (alias) => {
        const config = {
            enabled: true,
            readAlias: 'catalog-read',
            writeAlias: 'catalog-write',
        } as SearchConfig;
        const reader = {} as CatalogProjectionReader;
        const indexManager = { createIndex: jest.fn() } as unknown as CatalogIndexManager;
        const service = new CatalogRebuildService(config, reader, indexManager);

        await expect(service.rebuild({ evaluationAlias: alias, activate: false })).rejects.toThrow(
            'cannot replace a catalog read or write alias'
        );
        expect(indexManager.createIndex).not.toHaveBeenCalled();
    });
});

function createSource(): CatalogProductProjectionSource {
    return {
        id: 1n,
        revision: 7,
        sellerId: 2n,
        slug: 'keyboard',
        name: '키보드',
        description: null,
        status: 'ACTIVE',
        updatedAt: new Date('2026-08-12T10:00:00.000Z'),
        deletedAt: null,
        items: [
            {
                id: 11n,
                sku: 'sku-1',
                name: '기본',
                totalPrice: '1.000',
                isTaxFree: false,
                saleStatus: 'ALLOW',
                sequence: 0,
                deletedAt: null,
                options: [],
            },
        ],
        categories: [],
        tags: [],
        media: [],
    };
}
