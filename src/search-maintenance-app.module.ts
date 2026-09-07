import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { searchMaintenanceEnvValidationSchema } from './global/config/env/search-maintenance-env.validation';

import { LoggingModule } from '~/global/config/logger/logging.module';
import { DatabaseModule } from '~/infra/database/database.module';
import { SearchModule } from '~/infra/search/search.module';

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
    ],
})
export class SearchMaintenanceAppModule {}
