import { Module } from '@nestjs/common';

import { SearchHealthController } from './search-health.controller';
import { SearchOutboxWorker } from './search-outbox.worker';
import { SearchModule } from './search.module';

import {
    PRODUCT_SEARCH_CURSOR_SECRET,
    PRODUCT_SEARCH_PORT,
} from '~/api/catalog/search/application/product-search.port';
import { ProductSearchService } from '~/api/catalog/search/application/product-search.service';
import { DecimalScalar } from '~/api/catalog/search/presentation/decimal.scalar';
import { ProductSearchResolver } from '~/api/catalog/search/presentation/product-search.resolver';
import { OpenSearchProductSearchAdapter } from '~/infra/search/opensearch-product-search.adapter';
import { SearchConfig } from '~/infra/search/search.config';

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
            inject: [SearchConfig],
            useFactory: (config: SearchConfig) => config.cursorSecret,
        },
    ],
})
export class SearchHttpModule {}
