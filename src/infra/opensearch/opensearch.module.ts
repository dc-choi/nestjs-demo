import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { OpenSearchHttpClient } from './opensearch.client.js';
import { OpenSearchConfig } from './opensearch.config.js';

/** OpenSearch connection shared by the search and recommendation modules. */
@Module({
    imports: [ConfigModule],
    providers: [OpenSearchConfig, OpenSearchHttpClient],
    exports: [OpenSearchConfig, OpenSearchHttpClient],
})
export class OpenSearchModule {}
