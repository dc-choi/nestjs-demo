import type { MikroORM as CoreMikroORM } from '@mikro-orm/core';
import { ReflectMetadataProvider } from '@mikro-orm/decorators/legacy';
import { MikroORM, MySqlDriver } from '@mikro-orm/mysql';

import { randomUUID } from 'node:crypto';
import {
    readMySqlIntegrationConnection,
    seedCatalogMaintenance,
} from 'test/integration/database/mysql-integration.config';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ProductEntity } from '~/api/catalog/domain/entity/product.entity';
import { MemberRole } from '~/api/member/domain/member-role';
import { MemberEntity } from '~/api/member/domain/member.entity';
import { databaseEntities } from '~/infra/database/entities';
import { SearchOutboxRecoveryService } from '~/infra/search/search-outbox-recovery.service';
import { SearchOutboxRelay } from '~/infra/search/search-outbox.relay';
import {
    SearchProjectionOutboxEntity,
    SearchProjectionOutboxStatus,
} from '~/infra/search/search-projection-outbox.entity';
import { SearchConfig } from '~/infra/search/search.config';

const describeMySql = process.env.MYSQL_INTEGRATION === '1' ? describe : describe.skip;

describeMySql('Search outbox recovery MySQL integration', () => {
    let orm: CoreMikroORM<MySqlDriver> | undefined;

    beforeAll(async () => {
        const connection = readMySqlIntegrationConnection();
        orm = await MikroORM.init<MySqlDriver>({
            driver: MySqlDriver,
            entities: [...databaseEntities],
            metadataProvider: ReflectMetadataProvider,
            ...connection,
            ensureDatabase: false,
            forceUtcTimezone: true,
            debug: false,
            pool: { min: 0, max: 4 },
        });
        const schemaDiff = await orm.schema.getUpdateSchemaSQL({ safe: true, dropTables: false });
        if (schemaDiff.trim().length > 0) {
            throw new Error(`Integration database does not match the applied migrations:\n${schemaDiff}`);
        }
        await orm.schema.clear();
        await seedCatalogMaintenance(orm.em.fork());
    }, 60_000);

    afterAll(async () => {
        if (!orm) return;
        try {
            await orm.schema.clear();
            await seedCatalogMaintenance(orm.em.fork());
        } finally {
            await orm.close(true);
        }
    });

    it('reclaims a stale lease without spending attempts, records DEAD_LETTER requeue evidence, then relays it', async () => {
        const staleEventId = await createOutboxEvent(orm!);
        await setOutboxStatus(orm!, staleEventId, {
            status: SearchProjectionOutboxStatus.PROCESSING,
            attempts: 9,
            leaseToken: randomUUID(),
            leasedUntil: new Date(Date.now() - 1_000),
            lastError: 'prior failure',
        });

        const synchronized = vi.fn(async () => undefined);
        const relay = new SearchOutboxRelay(orm! as never, { synchronize: synchronized } as never, enabledConfig());
        await expect(relay.drainUntilEmpty()).resolves.toMatchObject({ claimed: 1, processed: 1, failed: 0 });
        expect(synchronized).toHaveBeenCalledWith(expect.any(BigInt), 1);
        await expect(readOutbox(orm!, staleEventId)).resolves.toMatchObject({
            status: SearchProjectionOutboxStatus.PROCESSED,
            attempts: 9,
        });

        const deadLetterId = await createOutboxEvent(orm!);
        await setOutboxStatus(orm!, deadLetterId, {
            status: SearchProjectionOutboxStatus.DEAD_LETTER,
            attempts: 10,
            leaseToken: null,
            leasedUntil: null,
            lastError: 'Error: OpenSearch unavailable',
        });

        const recovery = new SearchOutboxRecoveryService(orm!);
        await expect(recovery.retryDeadLetters({ ids: [deadLetterId], reason: 'provider recovered' })).resolves.toEqual(
            {
                requeued: 1,
            }
        );
        await expect(readOutbox(orm!, deadLetterId)).resolves.toMatchObject({
            status: SearchProjectionOutboxStatus.PENDING,
            attempts: 10,
            lastError: 'Error: OpenSearch unavailable',
        });
        await expect(readRetryHistory(orm!, deadLetterId)).resolves.toEqual([
            {
                previousAttempts: 10,
                previousLastError: 'Error: OpenSearch unavailable',
                action: 'REQUEUED',
                reason: 'provider recovered',
            },
        ]);

        await expect(relay.drainUntilEmpty()).resolves.toMatchObject({ claimed: 1, processed: 1, failed: 0 });
        await expect(readOutbox(orm!, deadLetterId)).resolves.toMatchObject({
            status: SearchProjectionOutboxStatus.PROCESSED,
            attempts: 10,
            lastError: null,
        });
    }, 60_000);
});

function enabledConfig(): SearchConfig {
    return { enabled: true } as SearchConfig;
}

async function createOutboxEvent(orm: CoreMikroORM<MySqlDriver>): Promise<bigint> {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
    const em = orm.em.fork();
    const seller = Object.assign(new MemberEntity(), {
        name: 'Outbox Recovery Seller',
        email: `outbox-recovery-${suffix}@example.com`,
        hashedPassword: null,
        phone: '010-0000-9000',
        role: MemberRole.SELLER,
        lastLoginAt: null,
        membershipAt: null,
        deletedAt: null,
    });
    const product = Object.assign(new ProductEntity(), {
        slug: `outbox-recovery-${suffix}`,
        name: 'Outbox Recovery Product',
        description: null,
        returnPolicy: null,
        revision: 1,
        seller,
        deletedAt: null,
    });
    const event = new SearchProjectionOutboxEntity(product, 1);
    em.persist([seller, product, event]);
    await em.flush();
    return event.id;
}

async function setOutboxStatus(
    orm: CoreMikroORM<MySqlDriver>,
    eventId: bigint,
    state: Pick<SearchProjectionOutboxEntity, 'status' | 'attempts' | 'leaseToken' | 'leasedUntil' | 'lastError'>
): Promise<void> {
    await orm.em.fork().nativeUpdate(SearchProjectionOutboxEntity, { id: eventId }, state);
}

async function readOutbox(orm: CoreMikroORM<MySqlDriver>, eventId: bigint): Promise<SearchProjectionOutboxEntity> {
    const event = await orm.em.fork().findOne(SearchProjectionOutboxEntity, { id: eventId });
    if (!event) throw new Error('Search outbox event was not found');
    return event;
}

async function readRetryHistory(
    orm: CoreMikroORM<MySqlDriver>,
    eventId: bigint
): Promise<Array<{ previousAttempts: number; previousLastError: string | null; action: string; reason: string }>> {
    return orm.em.fork().execute(
        `SELECT previous_attempts AS previousAttempts,
                previous_last_error AS previousLastError,
                action,
                reason
           FROM search_projection_outbox_retry_history
          WHERE outbox_id = ?
          ORDER BY id`,
        [eventId.toString()]
    );
}
