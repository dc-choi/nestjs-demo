import { Migrator } from '@mikro-orm/migrations';

import { describe, expect, it } from 'vitest';
import { createMigrationMikroOrmOptions, migrationsOptions, seederOptions } from '~/infra/database/migration.config';

const environment = {
    ENV: 'test',
    MYSQL_HOST: 'writer',
    MYSQL_PORT: 3306,
    MYSQL_USER: 'writer-user',
    MYSQL_PASSWORD: 'writer-password',
    MYSQL_DATABASE: 'database',
    MYSQL_READ_REPLICA_HOST: 'replica',
    MYSQL_READ_REPLICA_PORT: 3307,
    MYSQL_READ_REPLICA_USER: 'replica-user',
    MYSQL_READ_REPLICA_PASSWORD: 'replica-password',
    MYSQL_READ_REPLICA_DATABASE: 'database',
};

describe('migration config', () => {
    it('uses only the primary connection and transactional migrations', () => {
        const options = createMigrationMikroOrmOptions(environment);

        expect(options.replicas).toEqual([]);
        expect(options.extensions).toEqual([Migrator]);
        expect(options.migrations).toEqual(migrationsOptions);
        expect(migrationsOptions).toMatchObject({
            transactional: true,
            allOrNothing: true,
            dropTables: false,
            snapshot: true,
        });
    });

    it('keeps production and TypeScript source paths explicit', () => {
        expect(migrationsOptions.path).toBe('dist/src/infra/database/migrations');
        expect(migrationsOptions.pathTs).toBe('src/infra/database/migrations');
        expect(seederOptions).toMatchObject({
            path: 'dist/src/infra/database/seeders',
            pathTs: 'src/infra/database/seeders',
            defaultSeeder: 'DatabaseSeeder',
        });
    });
});
