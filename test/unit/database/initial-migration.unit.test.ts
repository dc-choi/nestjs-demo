import { jest } from '@jest/globals';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Migration20260904140344_initial_schema } from '~/infra/database/migrations/Migration20260904140344_initial_schema';

describe('initial migration', () => {
    it('drops every created table in foreign-key-safe reverse order', () => {
        const upSql = collectSql('up');
        const downSql = collectSql('down');
        const createdTables = upSql.flatMap((sql) => sql.match(/^create table `([^`]+)`/)?.slice(1) ?? []);
        const droppedTables = downSql.flatMap((sql) => sql.match(/^drop table if exists `([^`]+)`;$/)?.slice(1) ?? []);

        expect(droppedTables).toEqual(createdTables.toReversed());
    });

    it('creates the fulfillment idempotency column and order-scoped unique key', () => {
        const sql = collectSql('up').join('\n');

        expect(sql).toContain('`idempotency_key` varchar(128) not null');
        expect(sql).toContain('add unique `fulfillments_order_id_idempotency_key_key` (`order_id`, `idempotency_key`)');

        const snapshot = JSON.parse(
            readFileSync(join(process.cwd(), 'src/infra/database/migrations/.snapshot-demo_nest.json'), 'utf8')
        ) as {
            tables: {
                name: string;
                columns: Record<string, unknown>;
                indexes: { keyName: string; columnNames: string[]; unique: boolean }[];
            }[];
        };
        const fulfillment = snapshot.tables.find(({ name }) => name === 'fulfillments');
        expect(fulfillment?.columns).toHaveProperty('idempotency_key');
        expect(fulfillment?.indexes).toContainEqual(
            expect.objectContaining({
                keyName: 'fulfillments_order_id_idempotency_key_key',
                columnNames: ['order_id', 'idempotency_key'],
                unique: true,
            })
        );
    });
});

function collectSql(method: 'up' | 'down'): string[] {
    const statements: string[] = [];
    const migration = Object.assign(Object.create(Migration20260904140344_initial_schema.prototype), {
        addSql: jest.fn((sql: string) => statements.push(sql)),
    }) as Migration20260904140344_initial_schema;

    void migration[method]();
    return statements;
}
