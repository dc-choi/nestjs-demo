import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { RecommendationModule } from '~/api/recommendation/recommendation.module.js';
import { SearchModule } from '~/api/search/search.module.js';
import { searchMaintenanceEnvValidationSchema } from '~/global/config/env/search-maintenance-env.validation.js';
import { LoggingModule } from '~/global/logger/logging.module.js';
import { DatabaseModule } from '~/infra/database/database.module.js';

@Module({
    imports: [
        ConfigModule.forRoot({
            isGlobal: true,
            envFilePath: '.env',
            validationSchema: searchMaintenanceEnvValidationSchema,
        }),
        LoggingModule,
        DatabaseModule,
        SearchModule,
        RecommendationModule,
    ],
})
export class SearchMaintenanceAppModule {}
