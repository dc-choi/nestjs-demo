import { describe, expect, it, vi } from 'vitest';
import { SearchOutboxRecoveryService } from '~/infra/search/search-outbox-recovery.service';

describe('Search outbox recovery', () => {
    it('reads a bounded DEAD_LETTER view without mutating it', async () => {
        const execute = vi.fn(async () => [
            {
                id: '7',
                product_id: '11',
                product_revision: 3,
                attempts: 10,
                last_error: 'Error: unavailable',
                created_at: new Date('2026-09-05T00:00:00.000Z'),
            },
        ]);
        const service = new SearchOutboxRecoveryService(ormFor(execute) as never);

        await expect(service.inspectDeadLetters({ productId: 11n, limit: 1 })).resolves.toEqual([
            {
                id: '7',
                productId: '11',
                productRevision: 3,
                attempts: 10,
                lastError: 'Error: unavailable',
                createdAt: new Date('2026-09-05T00:00:00.000Z'),
            },
        ]);
        const inspectionSql = String((execute.mock.calls as unknown as Array<[unknown]>)[0]?.[0]);
        expect(inspectionSql).toContain("status = 'DEAD_LETTER'");
        expect(inspectionSql).not.toContain('UPDATE');
    });

    it('requeues only selected dead letters and preserves failure evidence in audit history', async () => {
        const execute = vi.fn(async (sql: string) => {
            if (sql.includes('SELECT id, product_id')) {
                return [
                    {
                        id: '7',
                        product_id: '11',
                        product_revision: 3,
                        attempts: 10,
                        last_error: 'Error: unavailable',
                        created_at: new Date(),
                    },
                ];
            }
            return { affectedRows: 1 };
        });
        const service = new SearchOutboxRecoveryService(ormFor(execute) as never);

        await expect(service.retryDeadLetters({ ids: [7n], reason: ' provider recovered ' })).resolves.toEqual({
            requeued: 1,
        });
        const auditCall = execute.mock.calls.find(([sql]) =>
            String(sql).includes('search_projection_outbox_retry_history')
        )!;
        expect((auditCall as unknown as readonly unknown[])[1]).toEqual([
            '7',
            '11',
            10,
            'Error: unavailable',
            'REQUEUED',
            'provider recovered',
        ]);
        const updateCall = execute.mock.calls.find(([sql]) => String(sql).includes('UPDATE search_projection_outbox'))!;
        expect(updateCall[0]).toContain("status = 'DEAD_LETTER'");
        expect(updateCall[0]).not.toContain('last_error = NULL');
        expect(updateCall[0]).not.toContain('attempts =');
    });

    it('requires a bounded, explicit retry target and reason', async () => {
        const service = new SearchOutboxRecoveryService(ormFor(vi.fn()) as never);

        await expect(service.retryDeadLetters({ reason: 'replay' })).rejects.toThrow('either explicit dead-letter ids');
        await expect(service.retryDeadLetters({ productId: 1n, reason: 'replay' })).rejects.toThrow('explicit limit');
        await expect(service.retryDeadLetters({ ids: [1n], reason: '  ' })).rejects.toThrow('between 1 and 500');
        await expect(service.retryDeadLetters({ ids: [1n, 1n], reason: 'replay' })).rejects.toThrow('unique');
    });

    it('does not requeue processed or pending rows', async () => {
        const execute = vi.fn(async (sql: string) => {
            if (sql.includes('SELECT id, product_id')) return [];
            throw new Error('A non-dead-letter row must not be updated');
        });
        const service = new SearchOutboxRecoveryService(ormFor(execute) as never);

        await expect(service.retryDeadLetters({ ids: [7n], reason: 'replay' })).resolves.toEqual({ requeued: 0 });
        expect(execute.mock.calls).toHaveLength(1);
        expect(execute.mock.calls[0][0]).toContain("status = 'DEAD_LETTER'");
    });
});

function ormFor(execute: ReturnType<typeof vi.fn>) {
    const em = {
        execute,
        transactional: async <T>(callback: (tx: { execute: typeof execute }) => Promise<T>) => callback({ execute }),
    };
    return { em: { fork: vi.fn(() => em) } };
}
