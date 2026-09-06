import type { EntityManager } from '@mikro-orm/core';

import 'dotenv/config';
import { CatalogMaintenanceEntity } from '~/infra/search/catalog-maintenance.entity';

export interface MySqlIntegrationConnection {
    host: string;
    port: number;
    user: string;
    password: string;
    dbName: string;
}

export function readMySqlIntegrationConnection(): MySqlIntegrationConnection {
    const dbName = requiredString('MYSQL_DATABASE');
    assertIntegrationDatabase(dbName);

    return {
        host: requiredString('MYSQL_HOST'),
        port: requiredPort('MYSQL_PORT'),
        user: requiredString('MYSQL_USER'),
        password: requiredString('MYSQL_PASSWORD'),
        dbName,
    };
}

function requiredString(name: 'MYSQL_DATABASE' | 'MYSQL_HOST' | 'MYSQL_PASSWORD' | 'MYSQL_USER'): string {
    const value = process.env[name];
    if (!value) throw new Error(`Missing required environment variable: ${name}`);
    return value;
}

function requiredPort(name: 'MYSQL_PORT'): number {
    const value = Number(process.env[name]);
    if (!Number.isInteger(value) || value < 1 || value > 65_535) {
        throw new Error(`Environment variable ${name} must be a valid TCP port`);
    }
    return value;
}

function assertIntegrationDatabase(dbName: string): void {
    if (!dbName.endsWith('_integration')) {
        throw new Error('MYSQL_DATABASE must end with _integration before integration data cleanup');
    }
}

export async function seedCatalogMaintenance(em: EntityManager): Promise<void> {
    await em.upsert(CatalogMaintenanceEntity, { id: 1, ownerToken: null, startedAt: null });
}
