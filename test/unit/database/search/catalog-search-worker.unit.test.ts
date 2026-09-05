import { describe, expect, it, vi } from 'vitest';
import { CatalogProductProjectionSource } from '~/api/catalog/search/domain/product-search.document';
import { CatalogBulkError, CatalogIndexManager } from '~/infra/search/catalog-index.manager';
import { CatalogProjectionReader } from '~/infra/search/catalog-projection.reader';
import { CatalogSearchWorker } from '~/infra/search/catalog-search.worker';
import { SearchConfig } from '~/infra/search/search.config';

describe('Catalog search worker', () => {
    it('rereads and indexes the current primary revision for an older event', async () => {
        const source = createSource({ revision: 2 });
        const { worker, indexManager } = createWorker(source);

        await worker.synchronize(source.id, 1);

        expect(indexManager.writeExternal).toHaveBeenCalledWith(
            expect.objectContaining({ productId: '1', productRevision: 2, name: '현재 상품' })
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
        expect(indexManager.deleteExternal).toHaveBeenCalledWith('1', 3);
    });
});

function createWorker(source: CatalogProductProjectionSource) {
    const reader = { findById: vi.fn(async () => source) };
    const indexManager = {
        writeExternal: vi.fn(async () => undefined),
        deleteExternal: vi.fn(async () => undefined),
        getDocument: vi.fn(async () => null),
    };
    const worker = new CatalogSearchWorker(
        { writeAlias: 'catalog-products-write' } as SearchConfig,
        reader as unknown as CatalogProjectionReader,
        indexManager as unknown as CatalogIndexManager
    );
    return { worker, indexManager };
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
