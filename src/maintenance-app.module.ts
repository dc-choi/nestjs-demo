import { Module } from '@nestjs/common';

import { ApplicationModule } from './application.module';

import { SearchModule } from '~/infra/search/search.module';

@Module({ imports: [ApplicationModule, SearchModule] })
export class MaintenanceAppModule {}
