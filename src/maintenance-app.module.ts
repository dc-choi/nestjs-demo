import { Module } from '@nestjs/common';

import { ApplicationModule } from './application.module.js';

import { SearchModule } from '~/api/search/search.module.js';

@Module({ imports: [ApplicationModule, SearchModule] })
export class MaintenanceAppModule {}
