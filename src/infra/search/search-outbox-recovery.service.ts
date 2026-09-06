import { EntityManager, MikroORM } from '@mikro-orm/mysql';
import { Injectable } from '@nestjs/common';

const MAX_INSPECTION_LIMIT = 100;
const MAX_RETRY_IDS = 100;
const MAX_REASON_LENGTH = 500;

interface DeadLetterRow {
    id: unknown;
    product_id: unknown;
    product_revision: unknown;
    attempts: unknown;
    last_error: unknown;
    created_at: unknown;
}

export interface SearchOutboxDeadLetter {
    id: string;
    productId: string;
    productRevision: number;
    attempts: number;
    lastError: string | null;
    createdAt: Date;
}

export interface SearchOutboxDeadLetterInspectionOptions {
    productId?: bigint;
    limit?: number;
}

export interface SearchOutboxDeadLetterRetryOptions {
    ids?: readonly bigint[];
    productId?: bigint;
    limit?: number;
    reason: string;
}

@Injectable()
export class SearchOutboxRecoveryService {
    constructor(private readonly orm: MikroORM) {}

    async inspectDeadLetters(options: SearchOutboxDeadLetterInspectionOptions = {}): Promise<SearchOutboxDeadLetter[]> {
        const limit = validateLimit(options.limit ?? 50, 'inspection limit');
        const em = this.orm.em.fork({ useContext: false });
        const rows =
            options.productId === undefined
                ? await em.execute<DeadLetterRow[]>(
                      `SELECT id, product_id, product_revision, attempts, last_error, created_at
                     FROM search_projection_outbox
                    WHERE status = 'DEAD_LETTER'
                    ORDER BY id
                    LIMIT ?`,
                      [limit]
                  )
                : await em.execute<DeadLetterRow[]>(
                      `SELECT id, product_id, product_revision, attempts, last_error, created_at
                     FROM search_projection_outbox
                    WHERE status = 'DEAD_LETTER'
                      AND product_id = ?
                    ORDER BY id
                    LIMIT ?`,
                      [validateId(options.productId, 'product id').toString(), limit]
                  );
        return rows.map(toDeadLetter);
    }

    async retryDeadLetters(options: SearchOutboxDeadLetterRetryOptions): Promise<{ requeued: number }> {
        const reason = validateReason(options.reason);
        const target = validateRetryTarget(options);
        const em = this.orm.em.fork({ useContext: false });
        return em.transactional(async (tx) => {
            const rows = await selectDeadLettersForRetry(tx, target);
            if (rows.length === 0) return { requeued: 0 };

            await insertRetryAudit(tx, rows, reason);
            const ids = rows.map((row) => toBigInt(row.id, 'outbox id'));
            const result = await tx.execute<{ affectedRows?: number }>(
                `UPDATE search_projection_outbox
                    SET status = 'PENDING',
                        available_at = CURRENT_TIMESTAMP(3),
                        lease_token = NULL,
                        leased_until = NULL
                  WHERE status = 'DEAD_LETTER'
                    AND id IN (${ids.map(() => '?').join(', ')})`,
                ids.map(String),
                'run'
            );
            if (result.affectedRows !== ids.length)
                throw new Error('Search outbox dead-letter retry lost its target rows');
            return { requeued: ids.length };
        });
    }
}

type RetryTarget = { kind: 'ids'; ids: readonly bigint[] } | { kind: 'product'; productId: bigint; limit: number };

function validateRetryTarget(options: SearchOutboxDeadLetterRetryOptions): RetryTarget {
    const hasIds = options.ids !== undefined;
    const hasProductId = options.productId !== undefined;
    if (hasIds === hasProductId) {
        throw new Error('Specify either explicit dead-letter ids or a product id with a limit');
    }

    if (hasIds) {
        if (options.limit !== undefined) throw new Error('A retry limit is only valid with a product id');
        const ids = options.ids!.map((id) => validateId(id, 'outbox id'));
        if (ids.length === 0 || ids.length > MAX_RETRY_IDS) {
            throw new Error(`Retry ids must contain between 1 and ${MAX_RETRY_IDS} entries`);
        }
        if (new Set(ids.map(String)).size !== ids.length) throw new Error('Retry ids must be unique');
        return { kind: 'ids', ids };
    }

    if (options.limit === undefined) throw new Error('A product-scoped retry requires an explicit limit');
    return {
        kind: 'product',
        productId: validateId(options.productId!, 'product id'),
        limit: validateLimit(options.limit, 'retry limit'),
    };
}

async function selectDeadLettersForRetry(tx: EntityManager, target: RetryTarget): Promise<DeadLetterRow[]> {
    if (target.kind === 'ids') {
        return tx.execute<DeadLetterRow[]>(
            `SELECT id, product_id, product_revision, attempts, last_error, created_at
               FROM search_projection_outbox
              WHERE status = 'DEAD_LETTER'
                AND id IN (${target.ids.map(() => '?').join(', ')})
                FOR UPDATE`,
            target.ids.map(String)
        );
    }
    return tx.execute<DeadLetterRow[]>(
        `SELECT id, product_id, product_revision, attempts, last_error, created_at
           FROM search_projection_outbox
          WHERE status = 'DEAD_LETTER'
            AND product_id = ?
          ORDER BY id
          LIMIT ?
            FOR UPDATE`,
        [target.productId.toString(), target.limit]
    );
}

async function insertRetryAudit(tx: EntityManager, rows: readonly DeadLetterRow[], reason: string): Promise<void> {
    const placeholders = rows.map(() => '(?, ?, ?, ?, ?, ?)').join(', ');
    const params = rows.flatMap((row) => [
        toBigInt(row.id, 'outbox id').toString(),
        toBigInt(row.product_id, 'outbox product id').toString(),
        toInteger(row.attempts, 'outbox attempts'),
        toNullableString(row.last_error),
        'REQUEUED',
        reason,
    ]);
    await tx.execute(
        `INSERT INTO search_projection_outbox_retry_history
            (outbox_id, product_id, previous_attempts, previous_last_error, action, reason)
         VALUES ${placeholders}`,
        params,
        'run'
    );
}

function toDeadLetter(row: DeadLetterRow): SearchOutboxDeadLetter {
    const createdAt = row.created_at instanceof Date ? row.created_at : new Date(String(row.created_at));
    if (Number.isNaN(createdAt.getTime())) throw new Error('Invalid outbox created at');
    return {
        id: toBigInt(row.id, 'outbox id').toString(),
        productId: toBigInt(row.product_id, 'outbox product id').toString(),
        productRevision: toInteger(row.product_revision, 'outbox product revision'),
        attempts: toInteger(row.attempts, 'outbox attempts'),
        lastError: toNullableString(row.last_error),
        createdAt,
    };
}

function validateLimit(value: number, field: string): number {
    if (!Number.isInteger(value) || value < 1 || value > MAX_INSPECTION_LIMIT) {
        throw new Error(`Search outbox ${field} must be between 1 and ${MAX_INSPECTION_LIMIT}`);
    }
    return value;
}

function validateReason(value: string): string {
    if (typeof value !== 'string') throw new Error('Search outbox retry reason must be a string');
    const normalized = value.trim();
    if (normalized.length === 0 || normalized.length > MAX_REASON_LENGTH) {
        throw new Error(`Search outbox retry reason must be between 1 and ${MAX_REASON_LENGTH} characters`);
    }
    return normalized;
}

function validateId(value: bigint, field: string): bigint {
    if (typeof value !== 'bigint' || value < 1n) throw new Error(`Invalid ${field}`);
    return value;
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

function toNullableString(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    if (typeof value !== 'string') throw new Error('Invalid outbox last error');
    return value;
}
