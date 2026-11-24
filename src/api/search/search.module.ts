import { Module } from '@nestjs/common';

import { CatalogMaintenanceService } from './application/catalog-maintenance.service.js';
import { CatalogProductSynchronizer } from './application/catalog-product.synchronizer.js';
import { CatalogRebuildService } from './application/catalog-rebuild.service.js';
import { SearchHealthService } from './application/search-health.service.js';
import { SearchOutboxRecoveryService } from './application/search-outbox-recovery.service.js';
import { SearchOutboxRelay } from './application/search-outbox.relay.js';
import { SearchReconciliationService } from './application/search-reconciliation.service.js';
import { SearchRelevanceEvaluationService } from './application/search-relevance-evaluation.service.js';
import { CatalogIndexManager } from './infrastructure/catalog-index.manager.js';
import { CatalogProjectionReader } from './infrastructure/catalog-projection.reader.js';
import { OpenSearchProductSearchAdapter } from './infrastructure/opensearch-product-search.adapter.js';

import { OpenSearchModule } from '~/infra/opensearch/opensearch.module.js';

const searchProviders = [
    SearchOutboxRecoveryService,
    CatalogMaintenanceService,
    OpenSearchProductSearchAdapter,
    CatalogProjectionReader,
    CatalogIndexManager,
    CatalogRebuildService,
    CatalogProductSynchronizer,
    SearchOutboxRelay,
    SearchReconciliationService,
    SearchRelevanceEvaluationService,
    SearchHealthService,
] as const;

@Module({
    imports: [OpenSearchModule],
    providers: [...searchProviders],
    exports: [OpenSearchModule, ...searchProviders],
})
export class SearchModule {}
