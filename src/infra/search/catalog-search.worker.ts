import { Injectable } from '@nestjs/common';

import { CatalogBulkError, CatalogIndexManager } from './catalog-index.manager';
import { CatalogProjectionReader } from './catalog-projection.reader';
import { SearchConfig } from './search.config';

import { projectCatalogProduct } from '~/api/catalog/search/domain/catalog-projector';
import { MAX_PRODUCT_REVISION } from '~/api/catalog/search/domain/product-search.document';

@Injectable()
export class CatalogSearchWorker {
    constructor(
        private readonly config: SearchConfig,
        private readonly reader: CatalogProjectionReader,
        private readonly indexManager: CatalogIndexManager
    ) {}

    async synchronize(productId: bigint, eventRevision: number): Promise<void> {
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
            if (desired) await this.indexManager.writeExternal(desired);
            else await this.indexManager.deleteExternal(productId.toString(), currentRevision);
        } catch (error) {
            if (!(error instanceof CatalogBulkError) || !error.failures.every(isConvergenceCandidate)) throw error;
            await this.assertAlreadyConverged(productId.toString(), currentRevision, desired);
        }
    }

    private async assertAlreadyConverged(
        productId: string,
        desiredRevision: number,
        desired: ReturnType<typeof projectCatalogProduct>
    ): Promise<void> {
        const indexed = await this.indexManager.getDocument(this.config.writeAlias, productId);
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
