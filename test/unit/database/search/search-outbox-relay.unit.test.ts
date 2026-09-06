import { describe, expect, it, vi } from 'vitest';
import { CatalogMaintenanceError } from '~/infra/search/catalog-maintenance.service';
import { SEARCH_OUTBOX_HEARTBEAT_MILLISECONDS, SearchOutboxRelay } from '~/infra/search/search-outbox.relay';

describe('Search outbox relay', () => {
    it('does not claim rows while OpenSearch is disabled', async () => {
        const orm = {
            em: {
                fork: vi.fn(() => {
                    throw new Error('The outbox must not be queried while search is disabled');
                }),
            },
        };
        const worker = { synchronize: vi.fn() };
        const relay = new SearchOutboxRelay(orm as never, worker as never, { enabled: false } as never);

        await expect(relay.drainBatch()).rejects.toThrow('OpenSearch must be enabled');
        expect(orm.em.fork).not.toHaveBeenCalled();
        expect(worker.synchronize).not.toHaveBeenCalled();
    });

    it('does not claim rows after cancellation', async () => {
        const fork = vi.fn(() => {
            throw new Error('The outbox must not be queried after cancellation');
        });
        const relay = new SearchOutboxRelay(
            { em: { fork } } as never,
            { synchronize: vi.fn() } as never,
            { enabled: true } as never
        );

        await expect(relay.drainUntilEmpty({ signal: AbortSignal.abort() })).resolves.toEqual({
            claimed: 0,
            processed: 0,
            failed: 0,
            deadLettered: 0,
        });
        expect(fork).not.toHaveBeenCalled();
    });

    it('claims each row immediately before it runs and does not preclaim a cancelled tail', async () => {
        const controller = new AbortController();
        const execute = vi.fn(async (sql: string) => {
            if (sql.includes('SELECT id, product_id'))
                return [{ id: '1', product_id: '10', product_revision: 1, attempts: 0 }];
            return { affectedRows: 1 };
        });
        const relay = new SearchOutboxRelay(
            ormFor(execute) as never,
            {
                synchronize: vi.fn(async () => {
                    controller.abort();
                }),
            } as never,
            { enabled: true } as never
        );

        await expect(relay.drainBatch(5, controller.signal)).resolves.toEqual({
            claimed: 1,
            processed: 1,
            failed: 0,
            deadLettered: 0,
        });
        expect(execute.mock.calls.filter(([sql]) => String(sql).includes('SELECT id, product_id'))).toHaveLength(1);
    });

    it('only increments attempts after a genuine processing failure', async () => {
        const execute = vi.fn(async (sql: string) => {
            if (sql.includes('SELECT id, product_id')) {
                return execute.mock.calls.filter(([statement]) => String(statement).includes('SELECT id, product_id'))
                    .length === 1
                    ? [{ id: '1', product_id: '10', product_revision: 1, attempts: 9 }]
                    : [];
            }
            return { affectedRows: 1 };
        });
        const relay = new SearchOutboxRelay(
            ormFor(execute) as never,
            { synchronize: vi.fn(async () => Promise.reject(new Error('OpenSearch unavailable'))) } as never,
            { enabled: true } as never
        );

        await expect(relay.drainBatch()).resolves.toEqual({ claimed: 1, processed: 0, failed: 1, deadLettered: 1 });
        const statements = execute.mock.calls.map(([sql]) => String(sql));
        expect(statements.find((sql) => sql.includes("SET status = 'PROCESSING'"))).not.toContain('attempts =');
        const failureCall = execute.mock.calls.find(([sql]) => String(sql).includes('attempts = attempts + 1'))!;
        expect((failureCall as unknown as readonly unknown[])[1]).toEqual(expect.arrayContaining(['DEAD_LETTER']));
    });

    it('does not alter a row after ownership is lost', async () => {
        const execute = vi.fn(async (sql: string) => {
            if (sql.includes('SELECT id, product_id')) {
                return execute.mock.calls.filter(([statement]) => String(statement).includes('SELECT id, product_id'))
                    .length === 1
                    ? [{ id: '1', product_id: '10', product_revision: 1, attempts: 0 }]
                    : [];
            }
            if (sql.includes("SET status = 'PROCESSED'")) return { affectedRows: 0 };
            return { affectedRows: 1 };
        });
        const relay = new SearchOutboxRelay(
            ormFor(execute) as never,
            { synchronize: vi.fn() } as never,
            { enabled: true } as never
        );

        await expect(relay.drainBatch()).resolves.toEqual({ claimed: 1, processed: 0, failed: 0, deadLettered: 0 });
        expect(
            execute.mock.calls.map(([sql]) => String(sql)).some((sql) => sql.includes('attempts = attempts + 1'))
        ).toBe(false);
    });

    it('renews a slow row with its owner token before completing it', async () => {
        vi.useFakeTimers();
        let complete: (() => void) | undefined;
        const execute = vi.fn(async (sql: string) => {
            if (sql.includes('SELECT id, product_id')) {
                return execute.mock.calls.filter(([statement]) => String(statement).includes('SELECT id, product_id'))
                    .length === 1
                    ? [{ id: '1', product_id: '10', product_revision: 1, attempts: 0 }]
                    : [];
            }
            return { affectedRows: 1 };
        });
        const relay = new SearchOutboxRelay(
            ormFor(execute) as never,
            { synchronize: vi.fn(() => new Promise<void>((resolve) => (complete = resolve))) } as never,
            { enabled: true } as never
        );

        const draining = relay.drainBatch();
        await vi.waitFor(() => expect(complete).toBeTypeOf('function'));
        await vi.advanceTimersByTimeAsync(SEARCH_OUTBOX_HEARTBEAT_MILLISECONDS);
        expect(execute.mock.calls.some(([sql]) => String(sql).includes('SET leased_until = ?'))).toBe(true);
        complete?.();
        await expect(draining).resolves.toEqual({ claimed: 1, processed: 1, failed: 0, deadLettered: 0 });
        vi.useRealTimers();
    });

    it('defers maintenance-blocked work without consuming its failure budget or claiming the next row', async () => {
        const execute = vi.fn(async (sql: string) => {
            if (sql.includes('SELECT id, product_id'))
                return [{ id: '1', product_id: '10', product_revision: 1, attempts: 9 }];
            return { affectedRows: 1 };
        });
        const relay = new SearchOutboxRelay(
            ormFor(execute) as never,
            { synchronize: vi.fn(async () => Promise.reject(new CatalogMaintenanceError())) } as never,
            { enabled: true } as never
        );

        await expect(relay.drainUntilEmpty({ batchSize: 5, maxBatches: 5 })).resolves.toEqual({
            claimed: 1,
            processed: 0,
            failed: 0,
            deadLettered: 0,
        });
        expect(execute.mock.calls.some(([sql]) => String(sql).includes("SET status = 'PENDING'"))).toBe(true);
        expect(execute.mock.calls.some(([sql]) => String(sql).includes('attempts = attempts + 1'))).toBe(false);
        expect(execute.mock.calls.filter(([sql]) => String(sql).includes('SELECT id, product_id'))).toHaveLength(1);
    });
});

function ormFor(execute: ReturnType<typeof vi.fn>) {
    const em = {
        execute,
        transactional: async <T>(callback: (tx: { execute: typeof execute }) => Promise<T>) => callback({ execute }),
    };
    return { em: { fork: vi.fn(() => em) } };
}
