import { defineConfig } from '@mikro-orm/mysql';
import { SeedManager } from '@mikro-orm/seeder';

import { readMikroOrmEnvironment } from './src/infra/database/database-environment';
import {
    createMigrationMikroOrmOptions,
    seederOptions,
} from './src/infra/database/migration.config';

import 'dotenv/config';

const migrationConfig = createMigrationMikroOrmOptions(readMikroOrmEnvironment(process.env));

export default defineConfig({
    ...migrationConfig,
    extensions: [...migrationConfig.extensions, SeedManager],
    seeder: seederOptions,
});
