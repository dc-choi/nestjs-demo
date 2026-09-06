import { Injectable } from '@nestjs/common';

import { CatalogBulkError, CatalogIndexManager, CatalogWriteTarget } from './catalog-index.manager';
import { CatalogMaintenanceService } from './catalog-maintenance.service';
import { CatalogProjectionReader } from './catalog-projection.reader';

import { projectCatalogProduct } from '~/api/catalog/search/domain/catalog-projector';
import { MAX_PRODUCT_REVISION } from '~/api/catalog/search/domain/product-search.document';

@Injectable()
export class CatalogSearchWorker {
    constructor(
        private readonly reader: CatalogProjectionReader,
        private readonly indexManager: CatalogIndexManager,
        private readonly maintenance: CatalogMaintenanceService
    ) {}

    async synchronize(productId: bigint, eventRevision: number, target?: CatalogWriteTarget): Promise<void> {
        if (target) return this.synchronizeCurrent(productId, eventRevision, target);
        return this.maintenance.withProjection(async (assertOwnership) => {
            const pinnedTarget = await this.indexManager.resolveWriteTarget();
            await assertOwnership();
            return this.synchronizeCurrent(productId, eventRevision, pinnedTarget);
        });
    }

    private async synchronizeCurrent(
        productId: bigint,
        eventRevision: number,
        target: CatalogWriteTarget
    ): Promise<void> {
        validateRevision(eventRevision);
        const source = await this.reader.findById(productId);
        if (source && eventRevision > source.revision) {
            throw new Error(
                `Search event revision ${eventRevision} is ahead of product ${productId} revision ${source.revision}`
            );
        }

        const currentRevision = source?.revision ?? eventRevision;
        validateRevision(currentRevision);
        const desired = source ? projectCatalogProduct(source) : null;
        try {
            if (desired) await this.indexManager.writeExternal(desired, target);
            else await this.indexManager.deleteExternal(productId.toString(), currentRevision, target);
        } catch (error) {
            if (!(error instanceof CatalogBulkError) || !error.failures.every(isConvergenceCandidate)) throw error;
            await this.assertAlreadyConverged(productId.toString(), currentRevision, desired, target);
        }
    }

    private async assertAlreadyConverged(
        productId: string,
        desiredRevision: number,
        desired: ReturnType<typeof projectCatalogProduct>,
        target: CatalogWriteTarget
    ): Promise<void> {
        const indexed = await this.indexManager.getDocument(target.indexName, productId);
        if (!desired && !indexed) return;
        if (
            desired &&
            indexed &&
            indexed.version >= desiredRevision &&
            JSON.stringify(indexed.source) === JSON.stringify(desired)
        ) {
            return;
        }
        throw new Error(`Search projection for product ${productId} did not converge after a version conflict`);
    }
}

function validateRevision(revision: number): void {
    if (!Number.isInteger(revision) || revision < 1 || revision > MAX_PRODUCT_REVISION) {
        throw new Error(`Invalid search projection revision: ${revision}`);
    }
}

function isConvergenceCandidate(failure: { status: number }): boolean {
    return failure.status === 404 || failure.status === 409;
}
