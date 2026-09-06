import { describe, expect, it, vi } from 'vitest';
import { CatalogProductProjectionSource } from '~/api/catalog/search/domain/product-search.document';
import { CatalogIndexManager } from '~/infra/search/catalog-index.manager';
import { CatalogMaintenanceService } from '~/infra/search/catalog-maintenance.service';
import { CatalogProjectionBatch, CatalogProjectionReader } from '~/infra/search/catalog-projection.reader';
import { CatalogRebuildService } from '~/infra/search/catalog-rebuild.service';
import { SearchReconciliationService } from '~/infra/search/search-reconciliation.service';
import { SearchConfig } from '~/infra/search/search.config';

describe('Catalog rebuild', () => {
    it('validates counts and a sample before moving aliases', async () => {
        const source = createSource();
        const reader = {
            fetchSearchableBatch: vi.fn(
                async (afterId: bigint | null): Promise<CatalogProjectionBatch> =>
                    afterId === null ? { sources: [source], nextCursor: 1n } : { sources: [], nextCursor: null }
            ),
            countSearchableProducts: vi.fn(async () => 1),
        } as unknown as CatalogProjectionReader;
        const calls: string[] = [];
        const indexManager = {
            getActiveAliasTargets: vi.fn(async () => ({ read: ['previous'], write: ['previous'] })),
            createIndex: vi.fn(async () => calls.push('create')),
            bulkIndex: vi.fn(async () => calls.push('bulk')),
            refresh: vi.fn(async () => calls.push('refresh')),
            count: vi.fn(async () => 1),
            getDocument: vi.fn(async (_index, id) => ({
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
            verifyQueryable: vi.fn(async () => calls.push('verify')),
            cutOverAliases: vi.fn(async () => calls.push('cutover')),
        } as unknown as CatalogIndexManager;
        const service = new CatalogRebuildService(
            { enabled: true } as SearchConfig,
            reader,
            indexManager,
            maintenance,
            reconciliation
        );

        await expect(service.rebuild({ buildId: 'test' })).resolves.toEqual({
            indexName: 'catalog-products-v001-test',
            indexedDocuments: 1,
            analyzer: 'standard',
            activated: true,
            evaluationAlias: null,
        });
        expect(calls).toEqual(['create', 'bulk', 'refresh', 'verify', 'cutover']);
        expect(indexManager.cutOverAliases).toHaveBeenCalledWith('catalog-products-v001-test', {
            read: ['previous'],
            write: ['previous'],
        });
    });

    it('does not move aliases when Bulk indexing fails', async () => {
        const reader = {
            fetchSearchableBatch: vi.fn(
                async (): Promise<CatalogProjectionBatch> => ({ sources: [createSource()], nextCursor: 1n })
            ),
        } as unknown as CatalogProjectionReader;
        const indexManager = {
            getActiveAliasTargets: vi.fn(async () => ({ read: [], write: [] })),
            createIndex: vi.fn(),
            bulkIndex: vi.fn(async () => {
                throw new Error('bulk failed');
            }),
            cutOverAliases: vi.fn(),
        } as unknown as CatalogIndexManager;
        const service = new CatalogRebuildService(
            { enabled: true } as SearchConfig,
            reader,
            indexManager,
            maintenance,
            reconciliation
        );

        await expect(service.rebuild({ buildId: 'failed' })).rejects.toThrow('bulk failed');
        expect(indexManager.cutOverAliases).not.toHaveBeenCalled();
    });

    it('rejects a snapshot acquired after maintenance ownership was lost', async () => {
        let ownsLock = true;
        const indexManager = {
            getActiveAliasTargets: vi.fn(async () => {
                ownsLock = false;
                return { read: ['successor'], write: ['successor'] };
            }),
            createIndex: vi.fn(),
            cutOverAliases: vi.fn(),
        } as unknown as CatalogIndexManager;
        const ownership = {
            rebuild: async <T>(work: (check: () => Promise<void>) => Promise<T>) =>
                work(async () => {
                    if (!ownsLock) throw new Error('Lock connection lost');
                }),
        } as CatalogMaintenanceService;
        const service = new CatalogRebuildService(
            { enabled: true } as SearchConfig,
            {} as CatalogProjectionReader,
            indexManager,
            ownership,
            reconciliation
        );

        await expect(service.rebuild({ buildId: 'stale' })).rejects.toThrow('Lock connection lost');
        expect(indexManager.createIndex).not.toHaveBeenCalled();
        expect(indexManager.cutOverAliases).not.toHaveBeenCalled();
    });

    it.each(['catalog-read', 'catalog-write'])('rejects the active %s alias as an evaluation alias', async (alias) => {
        const config = {
            enabled: true,
            readAlias: 'catalog-read',
            writeAlias: 'catalog-write',
        } as SearchConfig;
        const reader = {} as CatalogProjectionReader;
        const indexManager = { createIndex: vi.fn() } as unknown as CatalogIndexManager;
        const service = new CatalogRebuildService(config, reader, indexManager, maintenance, reconciliation);

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

const maintenance = {
    withProjection: async <T>(work: () => Promise<T>) => work(),
    rebuild: async <T>(work: (check: () => Promise<void>) => Promise<T>) => work(async () => undefined),
} as CatalogMaintenanceService;

const reconciliation = { reconcile: async () => ({ differenceCount: 0 }) } as SearchReconciliationService;
