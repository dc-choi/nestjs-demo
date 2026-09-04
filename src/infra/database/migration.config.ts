import type { MigrationsOptions, SeederOptions } from '@mikro-orm/core';
import { Migrator } from '@mikro-orm/migrations';

import { createMikroOrmCoreOptions } from './mikro-orm.config';

import type { MikroOrmEnvironment } from '~/infra/database/database-environment';

export const migrationsOptions: MigrationsOptions = {
    tableName: 'mikro_orm_migrations',
    path: 'dist/src/infra/database/migrations',
    pathTs: 'src/infra/database/migrations',
    glob: '!(*.d).{js,ts,cjs}',
    transactional: true,
    allOrNothing: true,
    dropTables: false,
    safe: false,
    snapshot: true,
    emit: 'ts',
};

export const seederOptions: SeederOptions = {
    path: 'dist/src/infra/database/seeders',
    pathTs: 'src/infra/database/seeders',
    defaultSeeder: 'DatabaseSeeder',
    glob: '!(*.d).{js,ts}',
    emit: 'ts',
};

export function createMigrationMikroOrmOptions(environment: MikroOrmEnvironment) {
    return {
        ...createMikroOrmCoreOptions(environment),
        replicas: [],
        extensions: [Migrator],
        migrations: migrationsOptions,
    };
}
