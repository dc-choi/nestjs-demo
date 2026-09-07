import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { SearchHealthController } from './search-health.controller';
import { SearchOutboxWorker } from './search-outbox.worker';
import { SearchModule } from './search.module';

import { resolveProductSearchCursorSecret } from '~/api/catalog/search/application/product-search-cursor-secret';
import {
    PRODUCT_SEARCH_CURSOR_SECRET,
    PRODUCT_SEARCH_PORT,
} from '~/api/catalog/search/application/product-search.port';
import { ProductSearchService } from '~/api/catalog/search/application/product-search.service';
import { DecimalScalar } from '~/api/catalog/search/presentation/decimal.scalar';
import { ProductSearchResolver } from '~/api/catalog/search/presentation/product-search.resolver';
import { OpenSearchProductSearchAdapter } from '~/infra/search/opensearch-product-search.adapter';

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
