import { Module } from '@nestjs/common';

import { ApplicationModule } from './application.module.js';

import { SearchModule } from '~/infra/search/search.module.js';

@Module({ imports: [ApplicationModule, SearchModule] })
export class MaintenanceAppModule {}
