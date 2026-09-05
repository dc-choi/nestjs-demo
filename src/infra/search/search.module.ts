import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { CatalogIndexManager } from './catalog-index.manager';
import { CatalogProjectionReader } from './catalog-projection.reader';
import { CatalogRebuildService } from './catalog-rebuild.service';
import { CatalogSearchWorker } from './catalog-search.worker';
import { OpenSearchProductSearchAdapter } from './opensearch-product-search.adapter';
import { OpenSearchHttpClient } from './opensearch.client';
import { SearchHealthService } from './search-health.service';
import { SearchOutboxRelay } from './search-outbox.relay';
import { SearchReconciliationService } from './search-reconciliation.service';
import { SearchRelevanceEvaluationService } from './search-relevance-evaluation.service';
import { SearchConfig } from './search.config';

const infrastructureProviders = [
    SearchConfig,
    OpenSearchHttpClient,
    OpenSearchProductSearchAdapter,
    CatalogProjectionReader,
    CatalogIndexManager,
    CatalogRebuildService,
    CatalogSearchWorker,
    SearchOutboxRelay,
    SearchReconciliationService,
    SearchRelevanceEvaluationService,
    SearchHealthService,
] as const;

@Module({
    imports: [ConfigModule],
    providers: [...infrastructureProviders],
    exports: [...infrastructureProviders],
})
export class SearchModule {}
