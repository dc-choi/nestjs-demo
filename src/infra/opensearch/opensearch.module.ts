import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { OpenSearchHttpClient } from './opensearch.client.js';
import { SearchConfig } from './search.config.js';

/** OpenSearch connection shared by the search and recommendation modules. */
@Module({
    imports: [ConfigModule],
    providers: [SearchConfig, OpenSearchHttpClient],
    exports: [SearchConfig, OpenSearchHttpClient],
})
export class OpenSearchModule {}
