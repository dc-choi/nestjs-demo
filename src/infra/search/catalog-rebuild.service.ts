import { Injectable } from '@nestjs/common';

import { CatalogAnalyzer, createCatalogIndexName } from './catalog-index.definition';
import { CatalogIndexManager } from './catalog-index.manager';
import { CatalogProjectionReader } from './catalog-projection.reader';
import { SearchConfig } from './search.config';

import { projectCatalogProduct } from '~/api/catalog/search/domain/catalog-projector';
import { ProductSearchDocument } from '~/api/catalog/search/domain/product-search.document';

export interface CatalogRebuildResult {
    indexName: string;
    indexedDocuments: number;
    analyzer: CatalogAnalyzer;
    activated: boolean;
    evaluationAlias: string | null;
}

@Injectable()
export class CatalogRebuildService {
    constructor(
        private readonly config: SearchConfig,
        private readonly reader: CatalogProjectionReader,
        private readonly indexManager: CatalogIndexManager
    ) {}

    async rebuild(
        options: {
            buildId?: string;
            batchSize?: number;
            analyzer?: CatalogAnalyzer;
            activate?: boolean;
            evaluationAlias?: string;
        } = {}
    ): Promise<CatalogRebuildResult> {
        if (!this.config.enabled) throw new Error('OpenSearch must be enabled before rebuilding the search index');

        const analyzer = options.analyzer ?? 'standard';
        const activate = options.activate ?? true;
        const evaluationAlias = options.evaluationAlias ?? null;
        if (evaluationAlias && !/^[a-z0-9][a-z0-9_-]{0,254}$/.test(evaluationAlias)) {
            throw new Error('Search evaluation alias has an invalid format');
        }
        if (evaluationAlias === this.config.readAlias || evaluationAlias === this.config.writeAlias) {
            throw new Error('An evaluation index cannot replace a catalog read or write alias');
        }
        if (activate && evaluationAlias) {
            throw new Error('An evaluation alias can only be assigned with activate=false');
        }
        const indexName = createCatalogIndexName(options.buildId ?? createBuildId(), analyzer);
        const batchSize = options.batchSize ?? 100;
        if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500) {
            throw new Error('Search rebuild batch size must be between 1 and 500');
        }

        await this.indexManager.createIndex(indexName, analyzer);
        let cursor: bigint | null = null;
        let indexedDocuments = 0;
        let sample: ProductSearchDocument | null = null;

        while (true) {
            const batch = await this.reader.fetchSearchableBatch(cursor, batchSize);
            if (batch.sources.length === 0) break;
            const documents = batch.sources.map((source) => {
                const document = projectCatalogProduct(source);
                if (!document) throw new Error(`Searchable product ${source.id} projected to a deletion`);
                return document;
            });

            await this.indexManager.bulkIndex(indexName, documents);
            sample ??= documents[0] ?? null;
            indexedDocuments += documents.length;
            if (batch.nextCursor === null || batch.nextCursor === cursor) {
                throw new Error('Catalog projection reader did not advance its cursor');
            }
            cursor = batch.nextCursor;
        }

        await this.indexManager.refresh(indexName);
        const [indexCount, databaseCount] = await Promise.all([
            this.indexManager.count(indexName),
            this.reader.countSearchableProducts(),
        ]);
        if (indexCount !== indexedDocuments || databaseCount !== indexedDocuments) {
            throw new Error(
                `Search rebuild count mismatch: indexed=${indexedDocuments}, OpenSearch=${indexCount}, MySQL=${databaseCount}`
            );
        }

        if (sample) await this.verifySample(indexName, sample);
        await this.indexManager.verifyQueryable(indexName);
        if (activate) await this.indexManager.cutOverAliases(indexName);
        else if (evaluationAlias) await this.indexManager.replaceReadAlias(indexName, evaluationAlias);
        return { indexName, indexedDocuments, analyzer, activated: activate, evaluationAlias };
    }

    private async verifySample(indexName: string, expected: ProductSearchDocument): Promise<void> {
        const actual = await this.indexManager.getDocument(indexName, expected.productId);
        if (
            !actual ||
            actual.version !== expected.productRevision ||
            JSON.stringify(actual.source) !== JSON.stringify(expected)
        ) {
            throw new Error(`Search rebuild sample validation failed for product ${expected.productId}`);
        }
    }
}

function createBuildId(): string {
    return new Date()
        .toISOString()
        .replace(/[-:.TZ]/g, '')
        .toLowerCase();
}
