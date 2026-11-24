import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { SearchOutboxWorker } from './application/search-outbox.worker.js';
import { SearchHealthController } from './presentation/search-health.controller.js';
import { SearchModule } from './search.module.js';

import {
    PRODUCT_SEARCH_CURSOR_SECRET,
    resolveProductSearchCursorSecret,
} from '~/api/search/application/product-search-cursor-secret.js';
import { PRODUCT_SEARCH_PORT } from '~/api/search/application/product-search.port.js';
import { ProductSearchService } from '~/api/search/application/product-search.service.js';
import { OpenSearchProductSearchAdapter } from '~/api/search/infrastructure/opensearch-product-search.adapter.js';
import { DecimalScalar } from '~/api/search/presentation/decimal.scalar.js';
import { ProductSearchResolver } from '~/api/search/presentation/product-search.resolver.js';

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
