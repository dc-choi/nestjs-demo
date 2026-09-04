import { EntityManager, MikroORM } from '@mikro-orm/mysql';
import { Injectable } from '@nestjs/common';

import { CatalogSearchWorker } from './catalog-search.worker';
import { SearchConfig } from './search.config';

import { randomUUID } from 'node:crypto';

interface ClaimedOutboxRow {
    id: bigint;
    productId: bigint;
    productRevision: number;
    attempts: number;
    leaseToken: string;
}

interface OutboxRow {
    id: unknown;
    product_id: unknown;
    product_revision: unknown;
    attempts: unknown;
}

export interface SearchOutboxDrainResult {
    claimed: number;
    processed: number;
    failed: number;
    deadLettered: number;
}

const MAX_ATTEMPTS = 10;
const LEASE_MILLISECONDS = 5 * 60_000;

@Injectable()
export class SearchOutboxRelay {
    constructor(
        private readonly orm: MikroORM,
        private readonly worker: CatalogSearchWorker,
        private readonly config: SearchConfig
    ) {}

    async drainBatch(limit = 50): Promise<SearchOutboxDrainResult> {
        if (!this.config.enabled) throw new Error('OpenSearch must be enabled before draining the search outbox');
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
            throw new Error('Search outbox batch size must be between 1 and 100');
        }

        const events = await this.claim(limit);
        const result: SearchOutboxDrainResult = { claimed: events.length, processed: 0, failed: 0, deadLettered: 0 };
        for (const event of events) {
            try {
                await this.worker.synchronize(event.productId, event.productRevision);
                await this.markProcessed(event);
                result.processed += 1;
            } catch (error) {
                const deadLettered = event.attempts >= MAX_ATTEMPTS;
                await this.markFailed(event, error, deadLettered);
                result.failed += 1;
                if (deadLettered) result.deadLettered += 1;
            }
        }
        return result;
    }

    async drainUntilEmpty(options: { batchSize?: number; maxBatches?: number } = {}): Promise<SearchOutboxDrainResult> {
        const batchSize = options.batchSize ?? 50;
        const maxBatches = options.maxBatches ?? 100;
        if (!Number.isInteger(maxBatches) || maxBatches < 1 || maxBatches > 10_000) {
            throw new Error('Search outbox maxBatches must be between 1 and 10000');
        }

        const total: SearchOutboxDrainResult = { claimed: 0, processed: 0, failed: 0, deadLettered: 0 };
        for (let batch = 0; batch < maxBatches; batch += 1) {
            const current = await this.drainBatch(batchSize);
            total.claimed += current.claimed;
            total.processed += current.processed;
            total.failed += current.failed;
            total.deadLettered += current.deadLettered;
            if (current.claimed === 0) return total;
        }
        return total;
    }

    private async claim(limit: number): Promise<ClaimedOutboxRow[]> {
        const leaseToken = randomUUID();
        const leasedUntil = new Date(Date.now() + LEASE_MILLISECONDS);
        const em = this.orm.em.fork({ useContext: false });
        return em.transactional(async (tx) => {
            const rows = await tx.execute<OutboxRow[]>(
                `SELECT id, product_id, product_revision, attempts
                   FROM search_projection_outbox
                  WHERE status IN ('PENDING', 'PROCESSING')
                    AND available_at <= CURRENT_TIMESTAMP(3)
                    AND (status = 'PENDING' OR leased_until < CURRENT_TIMESTAMP(3))
                  ORDER BY id
                  LIMIT ?
                    FOR UPDATE SKIP LOCKED`,
                [limit]
            );
            if (rows.length === 0) return [];

            const ids = rows.map(({ id }) => toBigInt(id, 'outbox id'));
            await tx.execute(
                `UPDATE search_projection_outbox
                    SET status = 'PROCESSING',
                        attempts = attempts + 1,
                        lease_token = ?,
                        leased_until = ?,
                        last_error = NULL
                  WHERE id IN (${ids.map(() => '?').join(', ')})`,
                [leaseToken, leasedUntil, ...ids.map(String)],
                'run'
            );
            return rows.map((row) => ({
                id: toBigInt(row.id, 'outbox id'),
                productId: toBigInt(row.product_id, 'outbox product id'),
                productRevision: toInteger(row.product_revision, 'outbox product revision'),
                attempts: toInteger(row.attempts, 'outbox attempts') + 1,
                leaseToken,
            }));
        });
    }

    private async markProcessed(event: ClaimedOutboxRow): Promise<void> {
        await this.executeLeaseUpdate(
            `UPDATE search_projection_outbox
                SET status = 'PROCESSED',
                    processed_at = CURRENT_TIMESTAMP(3),
                    lease_token = NULL,
                    leased_until = NULL,
                    last_error = NULL
              WHERE id = ? AND lease_token = ?`,
            [event.id.toString(), event.leaseToken]
        );
    }

    private async markFailed(event: ClaimedOutboxRow, error: unknown, deadLettered: boolean): Promise<void> {
        const availableAt = new Date(Date.now() + Math.min(60_000, 250 * 2 ** Math.min(event.attempts, 8)));
        await this.executeLeaseUpdate(
            `UPDATE search_projection_outbox
                SET status = ?,
                    available_at = ?,
                    lease_token = NULL,
                    leased_until = NULL,
                    last_error = ?
              WHERE id = ? AND lease_token = ?`,
            [
                deadLettered ? 'DEAD_LETTER' : 'PENDING',
                availableAt,
                describeError(error),
                event.id.toString(),
                event.leaseToken,
            ]
        );
    }

    private async executeLeaseUpdate(sql: string, params: unknown[]): Promise<void> {
        const em: EntityManager = this.orm.em.fork({ useContext: false });
        const result = await em.execute<{ affectedRows?: number }>(sql, params, 'run');
        if (result.affectedRows !== 1) throw new Error('Search outbox lease was lost before status update');
    }
}

function describeError(error: unknown): string {
    if (error instanceof Error) return `${error.name}: ${error.message}`.slice(0, 1_000);
    return 'Unknown search projection error';
}

function toBigInt(value: unknown, field: string): bigint {
    const normalized = typeof value === 'bigint' ? value.toString() : String(value);
    if (!/^\d+$/.test(normalized)) throw new Error(`Invalid ${field}`);
    return BigInt(normalized);
}

function toInteger(value: unknown, field: string): number {
    const normalized = typeof value === 'number' ? value : Number(value);
    if (!Number.isSafeInteger(normalized) || normalized < 0) throw new Error(`Invalid ${field}`);
    return normalized;
}
