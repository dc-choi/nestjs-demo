import { Injectable } from '@nestjs/common';

import { CatalogIndexManager, CatalogWriteTarget, StoredProductSearchDocument } from './catalog-index.manager';
import { CatalogMaintenanceService } from './catalog-maintenance.service';
import { CatalogProjectionReader } from './catalog-projection.reader';
import { CatalogSearchWorker } from './catalog-search.worker';
import { SearchConfig } from './search.config';

import { projectCatalogProduct } from '~/api/catalog/search/domain/catalog-projector';
import { MAX_PRODUCT_REVISION } from '~/api/catalog/search/domain/product-search.document';

export const SearchReconciliationDifferenceKind = {
    MISSING: 'MISSING',
    STALE: 'STALE',
    EXTRA: 'EXTRA',
} as const;

export interface SearchReconciliationDifference {
    productId: string;
    kind: (typeof SearchReconciliationDifferenceKind)[keyof typeof SearchReconciliationDifferenceKind];
    databaseRevision: number | null;
    indexedRevision: number | null;
}

export interface SearchReconciliationResult {
    checkedDatabaseDocuments: number;
    checkedIndexedDocuments: number;
    differenceCount: number;
    repairedCount: number;
    differences: SearchReconciliationDifference[];
    samplesTruncated: boolean;
}

@Injectable()
export class SearchReconciliationService {
    constructor(
        private readonly config: SearchConfig,
        private readonly reader: CatalogProjectionReader,
        private readonly indexManager: CatalogIndexManager,
        private readonly worker: CatalogSearchWorker,
        private readonly maintenance: CatalogMaintenanceService
    ) {}

    async reconcile(
        options: { repair?: boolean; batchSize?: number; maxSamples?: number } = {},
        indexName = this.config.readAlias
    ): Promise<SearchReconciliationResult> {
        if (!/^[a-z0-9][a-z0-9_-]{0,254}$/.test(indexName)) throw new Error('Invalid reconciliation index');
        if (options.repair && indexName !== this.config.readAlias) {
            throw new Error('Repairs must target the active catalog alias');
        }
        if (!options.repair) return this.reconcileIndex(options, indexName);
        return this.maintenance.withProjection(async (assertOwnership) => {
            const target = await this.indexManager.resolveWriteTarget();
            await assertOwnership();
            return this.reconcileIndex(options, target.indexName, target);
        });
    }

    private async reconcileIndex(
        options: { repair?: boolean; batchSize?: number; maxSamples?: number },
        indexName: string,
        target?: CatalogWriteTarget
    ): Promise<SearchReconciliationResult> {
        if (!this.config.enabled) throw new Error('OpenSearch must be enabled before reconciliation');
        const batchSize = options.batchSize ?? 100;
        const maxSamples = options.maxSamples ?? 100;
        if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500) {
            throw new Error('Search reconciliation batch size must be between 1 and 500');
        }
        if (!Number.isInteger(maxSamples) || maxSamples < 0 || maxSamples > 10_000) {
            throw new Error('Search reconciliation maxSamples must be between 0 and 10000');
        }

        const result: SearchReconciliationResult = {
            checkedDatabaseDocuments: 0,
            checkedIndexedDocuments: 0,
            differenceCount: 0,
            repairedCount: 0,
            differences: [],
            samplesTruncated: false,
        };

        let cursor: bigint | null = null;
        while (true) {
            const batch = await this.reader.fetchSearchableBatch(cursor, batchSize);
            if (batch.sources.length === 0) break;
            const documents = batch.sources.map((source) => {
                const document = projectCatalogProduct(source);
                if (!document) throw new Error(`Searchable product ${source.id} projected to a deletion`);
                return document;
            });
            const indexed = await this.indexManager.getDocuments(
                indexName,
                documents.map(({ productId }) => productId)
            );

            for (const document of documents) {
                result.checkedDatabaseDocuments += 1;
                const stored = indexed.get(document.productId);
                if (!stored) {
                    recordDifference(result, maxSamples, {
                        productId: document.productId,
                        kind: SearchReconciliationDifferenceKind.MISSING,
                        databaseRevision: document.productRevision,
                        indexedRevision: null,
                    });
                    if (target) {
                        await this.worker.synchronize(BigInt(document.productId), document.productRevision, target);
                        result.repairedCount += 1;
                    }
                } else if (!documentsMatch(stored, document)) {
                    recordDifference(result, maxSamples, {
                        productId: document.productId,
                        kind: SearchReconciliationDifferenceKind.STALE,
                        databaseRevision: document.productRevision,
                        indexedRevision: stored.version,
                    });
                    if (target) {
                        if (stored.version === document.productRevision) {
                            await this.indexManager.repairExternal(document, target);
                        } else {
                            await this.worker.synchronize(BigInt(document.productId), document.productRevision, target);
                        }
                        result.repairedCount += 1;
                    }
                }
            }
            cursor = batch.nextCursor;
        }

        for await (const indexedBatch of this.indexManager.scanDocuments(indexName, batchSize)) {
            result.checkedIndexedDocuments += indexedBatch.length;
            const ids = indexedBatch.map(({ id }) => BigInt(id));
            const sources = await this.reader.findByIds(ids);
            const sourceById = new Map(sources.map((source) => [source.id.toString(), source]));
            for (const stored of indexedBatch) {
                const source = sourceById.get(stored.id);
                const desired = source ? projectCatalogProduct(source) : null;
                if (desired) continue;

                recordDifference(result, maxSamples, {
                    productId: stored.id,
                    kind: SearchReconciliationDifferenceKind.EXTRA,
                    databaseRevision: source?.revision ?? null,
                    indexedRevision: stored.version,
                });
                if (target) {
                    const revision = source?.revision ?? nextRevision(stored.version);
                    if (stored.version === revision) {
                        await this.indexManager.repairDeleteExternal(stored.id, revision, target);
                    } else {
                        await this.worker.synchronize(BigInt(stored.id), revision, target);
                    }
                    result.repairedCount += 1;
                }
            }
        }

        result.samplesTruncated = result.differenceCount > result.differences.length;
        return result;
    }
}

function documentsMatch(
    stored: StoredProductSearchDocument,
    desired: ReturnType<typeof projectCatalogProduct>
): boolean {
    return (
        desired !== null &&
        stored.version === desired.productRevision &&
        JSON.stringify(stored.source) === JSON.stringify(desired)
    );
}

function recordDifference(
    result: SearchReconciliationResult,
    maxSamples: number,
    difference: SearchReconciliationDifference
): void {
    result.differenceCount += 1;
    if (result.differences.length < maxSamples) result.differences.push(difference);
}

function nextRevision(indexedRevision: number): number {
    if (!Number.isInteger(indexedRevision) || indexedRevision < 0 || indexedRevision >= MAX_PRODUCT_REVISION) {
        throw new Error(`Cannot derive a deletion revision after indexed revision ${indexedRevision}`);
    }
    return indexedRevision + 1;
}
