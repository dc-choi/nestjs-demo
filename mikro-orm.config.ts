import { defineConfig } from '@mikro-orm/mysql';
import { SeedManager } from '@mikro-orm/seeder';

import { readMikroOrmEnvironment } from './src/infra/database/database-environment.js';
import {
    createMigrationMikroOrmOptions,
    seederOptions,
} from './src/infra/database/migration.config.js';

import 'dotenv/config';

const migrationConfig = createMigrationMikroOrmOptions(readMikroOrmEnvironment(process.env));

export default defineConfig({
    ...migrationConfig,
    extensions: [...migrationConfig.extensions, SeedManager],
    seeder: seederOptions,
});
