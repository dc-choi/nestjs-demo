import { MikroORM, MySqlDriver } from '@mikro-orm/mysql';

import { readMikroOrmEnvironment } from './database-environment';
import { createMigrationMikroOrmOptions } from './migration.config';

import 'dotenv/config';

async function runMigrations(): Promise<void> {
    const orm = await MikroORM.init<MySqlDriver>(createMigrationMikroOrmOptions(readMikroOrmEnvironment(process.env)));

    try {
        const migrated = await orm.migrator.up();
        process.stdout.write(`Applied ${migrated.length} migration(s).\n`);
    } finally {
        await orm.close(true);
    }
}

runMigrations().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Migration failed: ${message}\n`);
    process.exitCode = 1;
});
