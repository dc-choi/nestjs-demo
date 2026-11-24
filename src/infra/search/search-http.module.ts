import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { SearchHealthController } from './search-health.controller.js';
import { SearchOutboxWorker } from './search-outbox.worker.js';
import { SearchModule } from './search.module.js';

import {
    PRODUCT_SEARCH_CURSOR_SECRET,
    resolveProductSearchCursorSecret,
} from '~/api/catalog/search/application/product-search-cursor-secret.js';
import { PRODUCT_SEARCH_PORT } from '~/api/catalog/search/application/product-search.port.js';
import { ProductSearchService } from '~/api/catalog/search/application/product-search.service.js';
import { DecimalScalar } from '~/api/catalog/search/presentation/decimal.scalar.js';
import { ProductSearchResolver } from '~/api/catalog/search/presentation/product-search.resolver.js';
import { OpenSearchProductSearchAdapter } from '~/infra/search/opensearch-product-search.adapter.js';

@Module({
    imports: [SearchModule],
    controllers: [SearchHealthController],
    providers: [
        SearchOutboxWorker,
        ProductSearchService,
        ProductSearchResolver,
        DecimalScalar,
        {
            provide: PRODUCT_SEARCH_PORT,
            useExisting: OpenSearchProductSearchAdapter,
        },
        {
            provide: PRODUCT_SEARCH_CURSOR_SECRET,
            inject: [ConfigService],
            useFactory: resolveProductSearchCursorSecret,
        },
    ],
})
export class SearchHttpModule {}
