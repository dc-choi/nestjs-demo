import { describe, expect, it, vi } from 'vitest';
import { projectCatalogProduct } from '~/api/catalog/search/domain/catalog-projector';
import { CatalogProductProjectionSource } from '~/api/catalog/search/domain/product-search.document';
import { CatalogIndexManager } from '~/infra/search/catalog-index.manager';
import { CatalogMaintenanceService } from '~/infra/search/catalog-maintenance.service';
import { CatalogProjectionReader } from '~/infra/search/catalog-projection.reader';
import { CatalogSearchWorker } from '~/infra/search/catalog-search.worker';
import { SearchReconciliationService } from '~/infra/search/search-reconciliation.service';
import { SearchConfig } from '~/infra/search/search.config';

const target = { indexName: 'catalog-v1', writeAlias: 'catalog-v1-projection' };

describe('Search reconciliation', () => {
    it('repairs equal-version source drift with external_gte instead of the normal worker', async () => {
        const source: CatalogProductProjectionSource = {
            id: 1n,
            revision: 3,
            sellerId: 2n,
            slug: 'keyboard',
            name: '현재 이름',
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
        const reader = {
            fetchSearchableBatch: vi
                .fn<CatalogProjectionReader['fetchSearchableBatch']>()
                .mockResolvedValueOnce({ sources: [source], nextCursor: 1n })
                .mockResolvedValueOnce({ sources: [], nextCursor: null }),
        } as unknown as CatalogProjectionReader;
        const repairExternal = vi.fn();
        const indexedSource = { ...projectCatalogProduct(source)!, name: '손상된 이름' };
        const indexManager = {
            resolveWriteTarget: vi.fn().mockResolvedValue(target),
            getDocuments: vi.fn<CatalogIndexManager['getDocuments']>().mockResolvedValue(
                new Map([
                    [
                        '1',
                        {
                            id: '1',
                            version: 3,
                            source: indexedSource,
                        },
                    ],
                ])
            ),
            repairExternal,
            scanDocuments: async function* () {},
        } as unknown as CatalogIndexManager;
        const synchronize = vi.fn();
        const service = new SearchReconciliationService(
            { enabled: true, readAlias: 'catalog-read' } as SearchConfig,
            reader,
            indexManager,
            { synchronize } as unknown as CatalogSearchWorker,
            maintenance
        );

        await expect(service.reconcile({ repair: true })).resolves.toMatchObject({
            differenceCount: 1,
            repairedCount: 1,
        });
        expect(repairExternal).toHaveBeenCalledWith(
            expect.objectContaining({ productId: '1', productRevision: 3 }),
            target
        );
        expect(indexManager.getDocuments).toHaveBeenCalledWith(target.indexName, ['1']);
        expect(synchronize).not.toHaveBeenCalled();
    });
});

const maintenance = {
    withProjection: async <T>(work: (assert: () => Promise<void>) => Promise<T>) => work(async () => undefined),
    rebuild: async <T>(work: () => Promise<T>) => work(),
} as CatalogMaintenanceService;
