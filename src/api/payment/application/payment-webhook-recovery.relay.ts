import { EntityManager, MikroORM } from '@mikro-orm/mysql';
import { Injectable } from '@nestjs/common';

import { randomUUID } from 'node:crypto';
import { PaymentService } from '~/api/payment/application/payment.service';

const MAX_RECOVERY_ATTEMPTS = 10;
const LEASE_MILLISECONDS = 30_000;

interface ClaimedWebhookEvent {
    id: bigint;
    provider: string;
    providerEventId: string;
    retryCount: number;
    leaseToken: string;
}

interface WebhookRow {
    id: unknown;
    provider: unknown;
    provider_event_id: unknown;
    retry_count: unknown;
}

export interface PaymentWebhookRecoveryDrainResult {
    claimed: number;
    processed: number;
    retried: number;
    failed: number;
}

/** Drains only signature-verified inbox rows. Leases make multiple HTTP replicas safe. */
@Injectable()
export class PaymentWebhookRecoveryRelay {
    constructor(
        private readonly orm: MikroORM,
        private readonly paymentService: PaymentService
    ) {}

    async drainBatch(limit = 25): Promise<PaymentWebhookRecoveryDrainResult> {
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
            throw new Error('Webhook recovery batch size must be between 1 and 100');
        }

        const claimed = await this.claim(limit);
        const result: PaymentWebhookRecoveryDrainResult = {
            claimed: claimed.length,
            processed: 0,
            retried: 0,
            failed: 0,
        };
        for (const event of claimed) {
            try {
                const recovery = await this.paymentService.recoverStoredWebhook(event.provider, event.providerEventId);
                if (recovery.disposition === 'PROCESSED') {
                    if (await this.markProcessed(event)) result.processed += 1;
                } else if (recovery.disposition === 'FAILED') {
                    if (await this.markFailed(event, recovery.errorMessage)) result.failed += 1;
                } else {
                    const updated = await this.markRetry(event, recovery.errorMessage, false);
                    if (updated === true) result.failed += 1;
                    else if (updated === false) result.retried += 1;
                }
            } catch (error: unknown) {
                const updated = await this.markRetry(event, describeError(error));
                if (updated === true) result.failed += 1;
                else if (updated === false) result.retried += 1;
            }
        }
        return result;
    }

    private async claim(limit: number): Promise<ClaimedWebhookEvent[]> {
        const leaseToken = randomUUID();
        const em = this.orm.em.fork({ useContext: false });
        return em.transactional(async (tx) => {
            const rows = await tx.execute<WebhookRow[]>(
                `SELECT id, provider, provider_event_id, retry_count
                   FROM payment_webhook_events
                  WHERE status = 'RECEIVED'
                    AND outcome IS NOT NULL
                    AND next_retry_at <= CURRENT_TIMESTAMP(3)
                    AND (lease_until IS NULL OR lease_until < CURRENT_TIMESTAMP(3))
                  ORDER BY id
                  LIMIT ?
                    FOR UPDATE SKIP LOCKED`,
                [limit]
            );
            if (rows.length === 0) return [];

            const ids = rows.map(({ id }) => toBigInt(id, 'webhook id'));
            await tx.execute(
                `UPDATE payment_webhook_events
                    SET lease_token = ?,
                        lease_until = DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL ? MICROSECOND)
                  WHERE id IN (${ids.map(() => '?').join(', ')})`,
                [leaseToken, LEASE_MILLISECONDS * 1_000, ...ids.map(String)],
                'run'
            );
            return rows.map((row) => ({
                id: toBigInt(row.id, 'webhook id'),
                provider: toString(row.provider, 'webhook provider'),
                providerEventId: toString(row.provider_event_id, 'webhook event id'),
                retryCount: toInteger(row.retry_count, 'webhook retry count'),
                leaseToken,
            }));
        });
    }

    private async markProcessed(event: ClaimedWebhookEvent): Promise<boolean> {
        return this.executeLeaseUpdate(
            `UPDATE payment_webhook_events
                SET status = 'PROCESSED',
                    processed_at = CURRENT_TIMESTAMP(3),
                    error_message = NULL,
                    lease_token = NULL,
                    lease_until = NULL
              WHERE id = ? AND lease_token = ? AND status = 'PROCESSED'`,
            [event.id.toString(), event.leaseToken]
        );
    }

    private async markFailed(event: ClaimedWebhookEvent, errorMessage: string | null): Promise<boolean> {
        return this.executeLeaseUpdate(
            `UPDATE payment_webhook_events
                SET status = 'FAILED',
                    processed_at = CURRENT_TIMESTAMP(3),
                    error_message = ?,
                    lease_token = NULL,
                    lease_until = NULL
              WHERE id = ? AND lease_token = ? AND status IN ('RECEIVED', 'FAILED')`,
            [errorMessage?.slice(0, 1_000) ?? 'Webhook recovery failed', event.id.toString(), event.leaseToken]
        );
    }

    /** Returns true when this attempt exhausted the bounded recovery budget. */
    private async markRetry(
        event: ClaimedWebhookEvent,
        errorMessage: string | null,
        processingFailed = true
    ): Promise<boolean | null> {
        const retryCount = event.retryCount + (processingFailed ? 1 : 0);
        const exhausted = processingFailed && retryCount >= MAX_RECOVERY_ATTEMPTS;
        const retryDelay = processingFailed ? retryDelayMilliseconds(retryCount) : 60_000;
        const updated = await this.executeLeaseUpdate(
            `UPDATE payment_webhook_events
                SET status = ?,
                    retry_count = ?,
                    next_retry_at = DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL ? MICROSECOND),
                    processed_at = CASE WHEN ? = 'FAILED' THEN CURRENT_TIMESTAMP(3) ELSE NULL END,
                    error_message = ?,
                    lease_token = NULL,
                    lease_until = NULL
              WHERE id = ? AND lease_token = ? AND status = 'RECEIVED'`,
            [
                exhausted ? 'FAILED' : 'RECEIVED',
                retryCount,
                retryDelay * 1_000,
                exhausted ? 'FAILED' : 'RECEIVED',
                errorMessage?.slice(0, 1_000) ?? 'Webhook recovery failed',
                event.id.toString(),
                event.leaseToken,
            ]
        );
        return updated ? exhausted : null;
    }

    private async executeLeaseUpdate(sql: string, params: unknown[]): Promise<boolean> {
        const em: EntityManager = this.orm.em.fork({ useContext: false });
        const result = await em.execute<{ affectedRows?: number }>(sql, params, 'run');
        return result.affectedRows === 1;
    }
}

function retryDelayMilliseconds(retryCount: number): number {
    return Math.min(60_000, 1_000 * 2 ** Math.min(retryCount - 1, 6));
}

function describeError(error: unknown): string {
    return error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 1_000) : 'Webhook recovery failed';
}

function toBigInt(value: unknown, field: string): bigint {
    const normalized = typeof value === 'bigint' ? value.toString() : String(value);
    if (!/^\d+$/.test(normalized)) throw new Error(`Invalid ${field}`);
    return BigInt(normalized);
}

function toString(value: unknown, field: string): string {
    if (typeof value !== 'string' || value.length === 0) throw new Error(`Invalid ${field}`);
    return value;
}

function toInteger(value: unknown, field: string): number {
    const normalized = typeof value === 'number' ? value : Number(value);
    if (!Number.isSafeInteger(normalized) || normalized < 0) throw new Error(`Invalid ${field}`);
    return normalized;
}
