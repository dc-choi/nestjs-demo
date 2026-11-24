import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { CatalogIndexManager } from './catalog-index.manager.js';
import { CatalogMaintenanceService } from './catalog-maintenance.service.js';
import { CatalogProjectionReader } from './catalog-projection.reader.js';
import { CatalogRebuildService } from './catalog-rebuild.service.js';
import { CatalogSearchWorker } from './catalog-search.worker.js';
import { OpenSearchProductSearchAdapter } from './opensearch-product-search.adapter.js';
import { OpenSearchHttpClient } from './opensearch.client.js';
import { SearchHealthService } from './search-health.service.js';
import { SearchOutboxRecoveryService } from './search-outbox-recovery.service.js';
import { SearchOutboxRelay } from './search-outbox.relay.js';
import { SearchReconciliationService } from './search-reconciliation.service.js';
import { SearchRelevanceEvaluationService } from './search-relevance-evaluation.service.js';
import { SearchConfig } from './search.config.js';

const infrastructureProviders = [
    SearchOutboxRecoveryService,
    CatalogMaintenanceService,
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
