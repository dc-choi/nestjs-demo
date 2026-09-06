import { describe, expect, it, vi } from 'vitest';
import { CatalogProductProjectionSource } from '~/api/catalog/search/domain/product-search.document';
import { CatalogBulkError, CatalogIndexManager } from '~/infra/search/catalog-index.manager';
import { CatalogMaintenanceService } from '~/infra/search/catalog-maintenance.service';
import { CatalogProjectionReader } from '~/infra/search/catalog-projection.reader';
import { CatalogSearchWorker } from '~/infra/search/catalog-search.worker';

const target = { indexName: 'catalog-v1', writeAlias: 'catalog-v1-projection' };

describe('Catalog search worker', () => {
    it('rereads and indexes the current primary revision for an older event', async () => {
        const source = createSource({ revision: 2 });
        const { worker, indexManager } = createWorker(source);

        await worker.synchronize(source.id, 1);

        expect(indexManager.writeExternal).toHaveBeenCalledWith(
            expect.objectContaining({ productId: '1', productRevision: 2, name: '현재 상품' }),
            target
        );
    });

    it('rejects an event revision ahead of the primary state', async () => {
        const source = createSource({ revision: 2 });
        const { worker, indexManager } = createWorker(source);

        await expect(worker.synchronize(source.id, 3)).rejects.toThrow('ahead of product');
        expect(indexManager.writeExternal).not.toHaveBeenCalled();
    });

    it('treats a repeated delete of an already absent document as converged', async () => {
        const source = createSource({ revision: 3, status: 'CLOSED' });
        const { worker, indexManager } = createWorker(source);
        indexManager.deleteExternal.mockRejectedValue(
            new CatalogBulkError([{ documentId: '1', status: 404, error: { type: 'document_missing_exception' } }])
        );
        indexManager.getDocument.mockResolvedValue(null);

        await expect(worker.synchronize(source.id, 3)).resolves.toBeUndefined();
        expect(indexManager.deleteExternal).toHaveBeenCalledWith('1', 3, target);
        expect(indexManager.getDocument).toHaveBeenCalledWith(target.indexName, '1');
    });

    it('pins the target before reading a revision that can become stale during cutover', async () => {
        const source = createSource();
        const { worker, reader, indexManager } = createWorker(source);
        reader.findById.mockImplementation(async () => {
            indexManager.resolveWriteTarget.mockResolvedValue({
                indexName: 'catalog-v2',
                writeAlias: 'catalog-v2-projection',
            });
            return source;
        });

        await worker.synchronize(source.id, source.revision);

        expect(indexManager.resolveWriteTarget).toHaveBeenCalledTimes(1);
        expect(indexManager.writeExternal).toHaveBeenCalledWith(expect.anything(), target);
    });

    it('does not read or write after losing the admission lock while resolving the target', async () => {
        const { reader, indexManager } = createWorker(createSource());
        const assertOwnership = vi.fn().mockRejectedValue(new Error('lock connection lost'));
        const worker = new CatalogSearchWorker(
            reader as unknown as CatalogProjectionReader,
            indexManager as unknown as CatalogIndexManager,
            {
                withProjection: (work: (assert: () => Promise<void>) => Promise<void>) => work(assertOwnership),
            } as CatalogMaintenanceService
        );

        await expect(worker.synchronize(1n, 1)).rejects.toThrow('lock connection lost');
        expect(reader.findById).not.toHaveBeenCalled();
        expect(indexManager.writeExternal).not.toHaveBeenCalled();
    });
});

function createWorker(source: CatalogProductProjectionSource) {
    const reader = { findById: vi.fn(async () => source) };
    const indexManager = {
        resolveWriteTarget: vi.fn(async () => target),
        writeExternal: vi.fn(async () => undefined),
        deleteExternal: vi.fn(async () => undefined),
        getDocument: vi.fn(async () => null),
    };
    const worker = new CatalogSearchWorker(
        reader as unknown as CatalogProjectionReader,
        indexManager as unknown as CatalogIndexManager,
        maintenance
    );
    return { worker, reader, indexManager };
}

function createSource(
    overrides: Partial<Pick<CatalogProductProjectionSource, 'revision' | 'status'>> = {}
): CatalogProductProjectionSource {
    return {
        id: 1n,
        revision: 1,
        sellerId: 2n,
        slug: 'current-product',
        name: '현재 상품',
        description: null,
        status: 'ACTIVE',
        updatedAt: new Date('2026-09-04T00:00:00.000Z'),
        deletedAt: null,
        items: [
            {
                id: 11n,
                sku: 'sku-1',
                name: '기본',
                totalPrice: '1000.000',
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
        ...overrides,
    };
}

const maintenance = {
    withProjection: async <T>(work: (assert: () => Promise<void>) => Promise<T>) => work(async () => undefined),
    rebuild: async <T>(work: () => Promise<T>) => work(),
} as CatalogMaintenanceService;
