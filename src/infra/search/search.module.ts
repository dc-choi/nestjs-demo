import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { CatalogIndexManager } from './catalog-index.manager';
import { CatalogProjectionReader } from './catalog-projection.reader';
import { CatalogRebuildService } from './catalog-rebuild.service';
import { CatalogSearchWorker } from './catalog-search.worker';
import { OpenSearchHttpClient } from './opensearch.client';
import { SearchHealthController } from './search-health.controller';
import { SearchHealthService } from './search-health.service';
import { SearchOutboxRelay } from './search-outbox.relay';
import { SearchOutboxWorker } from './search-outbox.worker';
import { SearchReconciliationService } from './search-reconciliation.service';
import { SearchRelevanceEvaluationService } from './search-relevance-evaluation.service';
import { SearchConfig } from './search.config';

import { ProductSearchService } from '~/api/catalog/search/application/product-search.service';
import { DecimalScalar } from '~/api/catalog/search/presentation/decimal.scalar';
import { ProductSearchResolver } from '~/api/catalog/search/presentation/product-search.resolver';

const infrastructureProviders = [
    SearchConfig,
    OpenSearchHttpClient,
    CatalogProjectionReader,
    CatalogIndexManager,
    CatalogRebuildService,
    CatalogSearchWorker,
    SearchOutboxRelay,
    SearchReconciliationService,
    SearchRelevanceEvaluationService,
    SearchHealthService,
    SearchOutboxWorker,
] as const;

@Module({
    imports: [ConfigModule],
    controllers: [SearchHealthController],
    providers: [...infrastructureProviders, ProductSearchService, ProductSearchResolver, DecimalScalar],
    exports: [...infrastructureProviders],
})
export class SearchModule {}
