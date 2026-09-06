import { EntityManager, MikroORM } from '@mikro-orm/mysql';
import { Injectable } from '@nestjs/common';

import { CatalogMaintenanceError } from './catalog-maintenance.service';
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

interface SearchOutboxDrainOptions {
    batchSize?: number;
    maxBatches?: number;
    signal?: AbortSignal;
}

const MAX_ATTEMPTS = 10;
const MAINTENANCE_DEFER_MILLISECONDS = 1_000;
export const SEARCH_OUTBOX_LEASE_MILLISECONDS = 5 * 60_000;
export const SEARCH_OUTBOX_HEARTBEAT_MILLISECONDS = SEARCH_OUTBOX_LEASE_MILLISECONDS / 2;

@Injectable()
export class SearchOutboxRelay {
    constructor(
        private readonly orm: MikroORM,
        private readonly worker: CatalogSearchWorker,
        private readonly config: SearchConfig
    ) {}

    async drainBatch(limit = 50, signal?: AbortSignal): Promise<SearchOutboxDrainResult> {
        return (await this.drainBatchInternal(limit, signal)).result;
    }

    async drainUntilEmpty(options: SearchOutboxDrainOptions = {}): Promise<SearchOutboxDrainResult> {
        const batchSize = options.batchSize ?? 50;
        const maxBatches = options.maxBatches ?? 100;
        if (!Number.isInteger(maxBatches) || maxBatches < 1 || maxBatches > 10_000) {
            throw new Error('Search outbox maxBatches must be between 1 and 10000');
        }

        const total = emptyDrainResult();
        for (let batch = 0; batch < maxBatches; batch += 1) {
            if (options.signal?.aborted) return total;
            const current = await this.drainBatchInternal(batchSize, options.signal);
            total.claimed += current.result.claimed;
            total.processed += current.result.processed;
            total.failed += current.result.failed;
            total.deadLettered += current.result.deadLettered;
            if (current.maintenanceDeferred || current.result.claimed === 0) return total;
        }
        return total;
    }

    private async drainBatchInternal(
        limit: number,
        signal?: AbortSignal
    ): Promise<{ result: SearchOutboxDrainResult; maintenanceDeferred: boolean }> {
        if (!this.config.enabled) throw new Error('OpenSearch must be enabled before draining the search outbox');
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
            throw new Error('Search outbox batch size must be between 1 and 100');
        }

        const result = emptyDrainResult();
        let maintenanceDeferred = false;
        while (result.claimed < limit && !signal?.aborted) {
            const event = await this.claimOne();
            if (!event) break;

            result.claimed += 1;
            const outcome = await this.synchronizeWithLeaseHeartbeat(event);
            if (!outcome.ownsLease) continue;

            if (outcome.error instanceof CatalogMaintenanceError) {
                await this.deferForMaintenance(event);
                maintenanceDeferred = true;
                break;
            }

            if (outcome.synchronized) {
                if (await this.markProcessed(event)) result.processed += 1;
                continue;
            }

            const deadLettered = event.attempts + 1 >= MAX_ATTEMPTS;
            if (await this.markFailed(event, outcome.error, deadLettered)) {
                result.failed += 1;
                if (deadLettered) result.deadLettered += 1;
            }
        }
        return { result, maintenanceDeferred };
    }

    private async claimOne(): Promise<ClaimedOutboxRow | undefined> {
        const leaseToken = randomUUID();
        const leasedUntil = new Date(Date.now() + SEARCH_OUTBOX_LEASE_MILLISECONDS);
        const em = this.orm.em.fork({ useContext: false });
        return em.transactional(async (tx) => {
            const rows = await tx.execute<OutboxRow[]>(
                `SELECT id, product_id, product_revision, attempts
                   FROM search_projection_outbox
                  WHERE status IN ('PENDING', 'PROCESSING')
                    AND available_at <= CURRENT_TIMESTAMP(3)
                    AND (status = 'PENDING' OR leased_until < CURRENT_TIMESTAMP(3))
                  ORDER BY id
                  LIMIT 1
                    FOR UPDATE SKIP LOCKED`
            );
            const row = rows[0];
            if (!row) return undefined;

            const id = toBigInt(row.id, 'outbox id');
            await tx.execute(
                `UPDATE search_projection_outbox
                    SET status = 'PROCESSING',
                        lease_token = ?,
                        leased_until = ?
                  WHERE id = ?`,
                [leaseToken, leasedUntil, id.toString()],
                'run'
            );
            return {
                id,
                productId: toBigInt(row.product_id, 'outbox product id'),
                productRevision: toInteger(row.product_revision, 'outbox product revision'),
                attempts: toInteger(row.attempts, 'outbox attempts'),
                leaseToken,
            };
        });
    }

    private async synchronizeWithLeaseHeartbeat(
        event: ClaimedOutboxRow
    ): Promise<{ ownsLease: boolean; synchronized: boolean; error: unknown }> {
        let ownsLease = true;
        let renewal: Promise<void> | undefined;
        const heartbeat = () => {
            if (!ownsLease || renewal) return;
            renewal = this.renewLease(event)
                .then((renewed) => {
                    if (!renewed) ownsLease = false;
                })
                .catch(() => {
                    ownsLease = false;
                })
                .finally(() => {
                    renewal = undefined;
                });
        };
        const timer = setInterval(heartbeat, SEARCH_OUTBOX_HEARTBEAT_MILLISECONDS);
        timer.unref();

        let synchronized = false;
        let error: unknown = undefined;
        try {
            await this.worker.synchronize(event.productId, event.productRevision);
            synchronized = true;
        } catch (caught: unknown) {
            error = caught;
        } finally {
            clearInterval(timer);
            await renewal;
        }
        return { ownsLease, synchronized, error };
    }

    private async renewLease(event: ClaimedOutboxRow): Promise<boolean> {
        return this.executeLeaseUpdate(
            `UPDATE search_projection_outbox
                SET leased_until = ?
              WHERE id = ?
                AND status = 'PROCESSING'
                AND lease_token = ?`,
            [new Date(Date.now() + SEARCH_OUTBOX_LEASE_MILLISECONDS), event.id.toString(), event.leaseToken]
        );
    }

    private async markProcessed(event: ClaimedOutboxRow): Promise<boolean> {
        return this.executeLeaseUpdate(
            `UPDATE search_projection_outbox
                SET status = 'PROCESSED',
                    processed_at = CURRENT_TIMESTAMP(3),
                    lease_token = NULL,
                    leased_until = NULL,
                    last_error = NULL
              WHERE id = ?
                AND status = 'PROCESSING'
                AND lease_token = ?`,
            [event.id.toString(), event.leaseToken]
        );
    }

    private async deferForMaintenance(event: ClaimedOutboxRow): Promise<boolean> {
        return this.executeLeaseUpdate(
            `UPDATE search_projection_outbox
                SET status = 'PENDING',
                    available_at = ?,
                    lease_token = NULL,
                    leased_until = NULL
              WHERE id = ?
                AND status = 'PROCESSING'
                AND lease_token = ?`,
            [new Date(Date.now() + MAINTENANCE_DEFER_MILLISECONDS), event.id.toString(), event.leaseToken]
        );
    }

    private async markFailed(event: ClaimedOutboxRow, error: unknown, deadLettered: boolean): Promise<boolean> {
        const attempts = event.attempts + 1;
        const availableAt = new Date(Date.now() + Math.min(60_000, 250 * 2 ** Math.min(attempts, 8)));
        return this.executeLeaseUpdate(
            `UPDATE search_projection_outbox
                SET status = ?,
                    attempts = attempts + 1,
                    available_at = ?,
                    lease_token = NULL,
                    leased_until = NULL,
                    last_error = ?
              WHERE id = ?
                AND status = 'PROCESSING'
                AND lease_token = ?`,
            [
                deadLettered ? 'DEAD_LETTER' : 'PENDING',
                availableAt,
                describeError(error),
                event.id.toString(),
                event.leaseToken,
            ]
        );
    }

    private async executeLeaseUpdate(sql: string, params: unknown[]): Promise<boolean> {
        const em: EntityManager = this.orm.em.fork({ useContext: false });
        const result = await em.execute<{ affectedRows?: number }>(sql, params, 'run');
        return result.affectedRows === 1;
    }
}

function emptyDrainResult(): SearchOutboxDrainResult {
    return { claimed: 0, processed: 0, failed: 0, deadLettered: 0 };
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
