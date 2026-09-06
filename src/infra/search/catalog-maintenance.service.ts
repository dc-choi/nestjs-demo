import { EntityManager, LockMode } from '@mikro-orm/core';
import { MikroORM } from '@mikro-orm/mysql';
import { Injectable, ServiceUnavailableException } from '@nestjs/common';

import { CatalogMaintenanceEntity } from './catalog-maintenance.entity';

import { randomUUID } from 'node:crypto';

export class CatalogMaintenanceError extends ServiceUnavailableException {
    constructor() {
        super('상품 검색 인덱스를 재구축하고 있습니다. 잠시 후 다시 시도해 주세요.');
    }
}

/** Hold a shared admission lock until the catalog transaction or projection finishes. */
export async function assertCatalogWritable(em: EntityManager): Promise<void> {
    if (!em.isInTransaction()) throw new Error('Catalog admission requires a transaction');
    let gate: { owner_token: string | null } | undefined;
    try {
        // MikroORM's MySQL shared-lock clause uses legacy LOCK IN SHARE MODE,
        // which cannot be combined with NOWAIT. MySQL 8 requires FOR SHARE here.
        const rows: { owner_token: string | null }[] = await em
            .getConnection('write')
            .execute(
                'SELECT owner_token FROM catalog_maintenance WHERE id = 1 FOR SHARE NOWAIT',
                [],
                'all',
                em.getTransactionContext()
            );
        gate = rows[0];
    } catch (error) {
        if (isLockUnavailable(error)) throw new CatalogMaintenanceError();
        throw error;
    }
    if (!gate) throw new Error('Catalog maintenance row is missing; apply database migrations');
    if (gate.owner_token !== null) throw new CatalogMaintenanceError();
}

@Injectable()
export class CatalogMaintenanceService {
    constructor(private readonly orm: MikroORM) {}

    async withProjection<T>(work: (assertOwnership: () => Promise<void>) => Promise<T>): Promise<T> {
        return this.orm.em.fork({ useContext: false }).transactional(async (em) => {
            await assertCatalogWritable(em);
            return work(() => assertCatalogWritable(em));
        });
    }

    async rebuild<T>(work: (assertOwnership: () => Promise<void>) => Promise<T>, resume = false): Promise<T> {
        const ownerToken = randomUUID();
        // Commit the closed gate first: a process or DB connection failure must not reopen writes.
        await this.orm.em.fork({ useContext: false }).transactional(async (em) => {
            const gate = await this.lockExclusive(em);
            if (gate.ownerToken !== null && !resume) {
                throw new Error(
                    'Catalog maintenance is already active; use --resume-maintenance after checking the failed rebuild'
                );
            }
            if (gate.ownerToken === null && resume) throw new Error('There is no catalog maintenance to resume');
            gate.ownerToken = ownerToken;
            gate.startedAt = new Date();
        });

        try {
            return await this.orm.em.fork({ useContext: false }).transactional(async (em) => {
                const gate = await this.lockExclusive(em);
                if (gate.ownerToken !== ownerToken) throw new Error('Catalog maintenance ownership changed');
                const assertOwnership = async () => {
                    // Use the original lock connection: a replacement connection would hide a lost lock.
                    const current = await this.lockExclusive(em);
                    if (current.ownerToken !== ownerToken) throw new Error('Catalog maintenance ownership changed');
                };
                const result = await work(assertOwnership);
                await assertOwnership();
                gate.ownerToken = null;
                gate.startedAt = null;
                return result;
            });
        } catch (error) {
            throw new Error(
                'Rebuild failed; this execution did not release maintenance. Check ownership before search:rebuild --resume-maintenance',
                { cause: error }
            );
        }
    }

    private async lockExclusive(em: EntityManager): Promise<CatalogMaintenanceEntity> {
        const gate = await em.findOne(CatalogMaintenanceEntity, 1, {
            lockMode: LockMode.PESSIMISTIC_WRITE_OR_FAIL,
            refresh: true,
        });
        if (!gate) throw new Error('Catalog maintenance row is missing; apply database migrations');
        return gate;
    }
}

function isLockUnavailable(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const { code, errno, cause } = error as { code?: string; errno?: number; cause?: unknown };
    return code === 'ER_LOCK_NOWAIT' || errno === 3572 || (cause !== undefined && isLockUnavailable(cause));
}
