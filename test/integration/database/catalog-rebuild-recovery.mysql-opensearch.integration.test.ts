import { type MikroORM as CoreMikroORM, type EntityManager } from '@mikro-orm/core';
import { ReflectMetadataProvider } from '@mikro-orm/decorators/legacy';
import { MikroORM, MySqlDriver } from '@mikro-orm/mysql';

import { randomUUID } from 'node:crypto';
import {
    readMySqlIntegrationConnection,
    seedCatalogMaintenance,
} from 'test/integration/database/mysql-integration.config';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductCommandService } from '~/api/catalog/application/product-command.service';
import { ItemSaleStatus } from '~/api/catalog/domain/entity/item-sale-status';
import { ProductStatus } from '~/api/catalog/domain/entity/product-status';
import { MemberRole } from '~/api/member/domain/member-role';
import { MemberEntity } from '~/api/member/domain/member.entity';
import { databaseEntities } from '~/infra/database/entities';
import { createCatalogIndexName } from '~/infra/search/catalog-index.definition';
import { CatalogIndexManager } from '~/infra/search/catalog-index.manager';
import { CatalogMaintenanceEntity } from '~/infra/search/catalog-maintenance.entity';
import { CatalogMaintenanceError, CatalogMaintenanceService } from '~/infra/search/catalog-maintenance.service';
import { CatalogProjectionReader } from '~/infra/search/catalog-projection.reader';
import { CatalogRebuildService } from '~/infra/search/catalog-rebuild.service';
import { CatalogSearchWorker } from '~/infra/search/catalog-search.worker';
import { OpenSearchHttpClient } from '~/infra/search/opensearch.client';
import { SearchOutboxRelay } from '~/infra/search/search-outbox.relay';
import { SearchReconciliationService } from '~/infra/search/search-reconciliation.service';
import { SearchConfig } from '~/infra/search/search.config';

const enabled = process.env.MYSQL_INTEGRATION === '1' && process.env.OPENSEARCH_INTEGRATION === '1';
const describeRecovery = enabled ? describe : describe.skip;

interface MaintenanceInternals {
    lockExclusive(em: EntityManager): Promise<unknown>;
}

describeRecovery('catalog rebuild recovery after MySQL connection loss', () => {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
    const config = {
        enabled: true,
        nodeUrl: new URL(process.env.OPENSEARCH_NODE_URL ?? 'http://127.0.0.1:9200'),
        readAlias: `catalog-recovery-read-${suffix}`,
        writeAlias: `catalog-recovery-write-${suffix}`,
        cursorSecret: 'integration-test-cursor-secret-at-least-32',
        requestTimeoutMs: 5_000,
    } as SearchConfig;
    const manager = new CatalogIndexManager(new OpenSearchHttpClient(config), config);
    let orm: CoreMikroORM<MySqlDriver>;
    let ownerOrm: CoreMikroORM<MySqlDriver>;
    let indexNames: string[];

    beforeAll(async () => {
        const connection = readMySqlIntegrationConnection();
        orm = await createOrm(connection, 5);
        const schemaDiff = await orm.schema.getUpdateSchemaSQL({ safe: true, dropTables: false });
        if (schemaDiff.trim()) throw new Error(`Integration database does not match migrations:\n${schemaDiff}`);
    }, 60_000);

    beforeEach(async () => {
        await orm.schema.clear();
        await seedCatalogMaintenance(orm.em.fork());
        ownerOrm = await createOrm(readMySqlIntegrationConnection(), 1, `catalog-recovery-owner-${suffix}`);
        indexNames = [];
    });

    afterEach(async () => {
        try {
            await Promise.all(indexNames.map((indexName) => manager.deleteIndex(indexName)));
        } finally {
            await ownerOrm.close(true);
        }
    });

    afterAll(async () => {
        try {
            await orm.schema.clear();
            await seedCatalogMaintenance(orm.em.fork());
        } finally {
            await orm.close(true);
        }
    });

    it.each([
        ['successor-first', true],
        ['successor-first', false],
        ['stale-first', true],
        ['stale-first', false],
    ] as const)(
        '%s keeps aliases safe when existing aliases=%s',
        async (order, existingAlias) => {
            const product = await createActiveProduct(orm, suffix);
            const maintenance = new CatalogMaintenanceService(orm);
            const ownerMaintenance = new CatalogMaintenanceService(ownerOrm);
            const reader = new CatalogProjectionReader(orm);
            const worker = new CatalogSearchWorker(reader, manager, maintenance);
            const relay = new SearchOutboxRelay(orm, worker, config);
            const reconciliation = new SearchReconciliationService(config, reader, manager, worker, maintenance);
            const rebuildA = new CatalogRebuildService(config, reader, manager, ownerMaintenance, reconciliation);
            const rebuildB = new CatalogRebuildService(config, reader, manager, maintenance, reconciliation);
            const oldIndex = createCatalogIndexName(`recovery-old-${suffix}-${existingAlias}`);
            const indexA = createCatalogIndexName(`recovery-a-${suffix}-${existingAlias}`);
            const indexB = createCatalogIndexName(`recovery-b-${suffix}-${existingAlias}`);
            const indexC = createCatalogIndexName(`recovery-c-${suffix}-${existingAlias}`);
            indexNames.push(oldIndex, indexA, indexB, indexC);
            if (existingAlias) {
                await manager.createIndex(oldIndex);
                await manager.cutOverAliases(oldIndex);
            }

            let connectionId: number | undefined;
            const internals = ownerMaintenance as unknown as MaintenanceInternals;
            const originalLockExclusive = internals.lockExclusive.bind(ownerMaintenance);
            const lockSpy = vi.spyOn(internals, 'lockExclusive').mockImplementation(async (em) => {
                const gate = await originalLockExclusive(em);
                const rows = await em
                    .getConnection('write')
                    .execute<
                        { connectionId: unknown }[]
                    >('SELECT CONNECTION_ID() AS connectionId', [], 'all', em.getTransactionContext());
                const current = Number(rows[0]?.connectionId);
                if (!Number.isSafeInteger(current) || current < 1)
                    throw new Error('Owner lock connection id is invalid');
                connectionId = current;
                return gate;
            });
            const aEntered = Promise.withResolvers<void>();
            const releaseA = Promise.withResolvers<void>();
            const bEntered = Promise.withResolvers<void>();
            const releaseB = Promise.withResolvers<void>();
            let cutovers = 0;
            const originalCutover = manager.cutOverAliases.bind(manager);
            const cutoverSpy = vi.spyOn(manager, 'cutOverAliases').mockImplementation(async (indexName, expected) => {
                cutovers += 1;
                if (cutovers === 1) {
                    aEntered.resolve();
                    await releaseA.promise;
                } else if (cutovers === 2 && order === 'stale-first') {
                    bEntered.resolve();
                    await releaseB.promise;
                }
                return originalCutover(indexName, expected);
            });

            const rebuildAResult = rebuildA.rebuild({
                buildId: `recovery-a-${suffix}-${existingAlias}`,
                batchSize: 10,
            });
            let rebuildBResult: Promise<unknown> | undefined;
            try {
                await awaitLatch(aEntered.promise, rebuildAResult);
                if (!connectionId) throw new Error('Owner lock connection was not captured');
                await orm.em.fork().execute(`KILL CONNECTION ${connectionId}`, [], 'run');
                rebuildBResult = rebuildB.rebuild({
                    buildId: `recovery-b-${suffix}-${existingAlias}`,
                    batchSize: 10,
                    resumeMaintenance: true,
                });

                if (order === 'successor-first') {
                    await expect(rebuildBResult).resolves.toMatchObject({ indexName: indexB, activated: true });
                    const updated = await product.commands.update(product.actor, {
                        productId: product.id,
                        expectedRevision: product.revision,
                        name: '연결 복구 뒤 최신 상품',
                    });
                    await expect(relay.drainUntilEmpty()).resolves.toMatchObject({ failed: 0 });
                    await manager.refresh(config.readAlias);
                    await expect(manager.getDocument(config.readAlias, product.id.toString())).resolves.toMatchObject({
                        version: updated.revision,
                        source: { name: '연결 복구 뒤 최신 상품' },
                    });
                    releaseA.resolve();
                    await expect(rebuildAResult).rejects.toThrow('Rebuild failed');
                    expect(await manager.getActiveAliasTargets()).toEqual({ read: [indexB], write: [indexB] });
                    expect((await orm.em.fork().findOneOrFail(CatalogMaintenanceEntity, 1)).ownerToken).toBeNull();
                } else {
                    await awaitLatch(bEntered.promise, rebuildBResult);
                    releaseA.resolve();
                    await expect(rebuildAResult).rejects.toThrow('Rebuild failed');
                    releaseB.resolve();
                    await expect(rebuildBResult).rejects.toThrow('Rebuild failed');
                    expect((await orm.em.fork().findOneOrFail(CatalogMaintenanceEntity, 1)).ownerToken).not.toBeNull();
                    await expect(
                        product.commands.update(product.actor, {
                            productId: product.id,
                            expectedRevision: product.revision,
                            name: '닫힌 게이트 상품',
                        })
                    ).rejects.toBeInstanceOf(CatalogMaintenanceError);
                    await expect(
                        rebuildB.rebuild({
                            buildId: `recovery-c-${suffix}-${existingAlias}`,
                            batchSize: 10,
                            resumeMaintenance: true,
                        })
                    ).resolves.toMatchObject({ indexName: indexC, activated: true });
                    expect((await orm.em.fork().findOneOrFail(CatalogMaintenanceEntity, 1)).ownerToken).toBeNull();
                }
            } finally {
                releaseA.resolve();
                releaseB.resolve();
                await Promise.allSettled([rebuildAResult, ...(rebuildBResult ? [rebuildBResult] : [])]);
                cutoverSpy.mockRestore();
                lockSpy.mockRestore();
            }
        },
        60_000
    );

    it.each(['projection', 'repair'] as const)(
        'keeps a delayed %s on its original index after its lock connection dies',
        async (mode) => {
            const product = await createActiveProduct(orm, suffix);
            const maintenance = new CatalogMaintenanceService(orm);
            const ownerMaintenance = new CatalogMaintenanceService(ownerOrm);
            const reader = new CatalogProjectionReader(orm);
            const worker = new CatalogSearchWorker(reader, manager, maintenance);
            const reconciliation = new SearchReconciliationService(config, reader, manager, worker, maintenance);
            const rebuild = new CatalogRebuildService(config, reader, manager, maintenance, reconciliation);
            const beforeBuildId = `projection-before-${suffix}`;
            const afterBuildId = `projection-after-${suffix}`;
            const beforeIndex = createCatalogIndexName(beforeBuildId);
            const afterIndex = createCatalogIndexName(afterBuildId);
            indexNames.push(beforeIndex, afterIndex);
            await rebuild.rebuild({ buildId: beforeBuildId });
            if (mode === 'repair') {
                const current = await manager.getDocument(beforeIndex, product.id.toString());
                await manager.repairExternal(
                    { ...current!.source, name: '손상된 상품 이름' },
                    await manager.resolveWriteTarget()
                );
            }

            let connectionId: number | undefined;
            const connection = ownerOrm.em.getConnection('write');
            const execute = connection.execute.bind(connection);
            const executeSpy = vi
                .spyOn(connection, 'execute')
                .mockImplementation(async (query, params, method, ctx) => {
                    const result = await execute(query, params, method, ctx);
                    if (typeof query === 'string' && query.includes('FOR SHARE NOWAIT')) {
                        const rows = await execute<{ connectionId: unknown }[]>(
                            'SELECT CONNECTION_ID() AS connectionId',
                            [],
                            'all',
                            ctx
                        );
                        connectionId = Number(rows[0].connectionId);
                    }
                    return result;
                });
            const entered = Promise.withResolvers<void>();
            const release = Promise.withResolvers<void>();
            const writeMethod = mode === 'projection' ? 'writeExternal' : 'repairExternal';
            const originalWrite = manager[writeMethod].bind(manager);
            const writeSpy = vi.spyOn(manager, writeMethod).mockImplementation(async (document, target) => {
                entered.resolve();
                await release.promise;
                return originalWrite(document, target);
            });
            const delayedWorker = new CatalogSearchWorker(reader, manager, ownerMaintenance);
            const delayedReconciliation = new SearchReconciliationService(
                config,
                reader,
                manager,
                delayedWorker,
                ownerMaintenance
            );
            const pending =
                mode === 'projection'
                    ? delayedWorker.synchronize(product.id, product.revision)
                    : delayedReconciliation.reconcile({ repair: true });
            try {
                await awaitLatch(entered.promise, pending);
                if (!Number.isSafeInteger(connectionId) || connectionId! < 1) {
                    throw new Error('Projection lock connection was not captured');
                }
                await orm.em.fork().execute(`KILL CONNECTION ${connectionId}`, [], 'run');
                await product.commands.delete(product.actor, {
                    productId: product.id,
                    expectedRevision: product.revision,
                });
                await rebuild.rebuild({ buildId: afterBuildId });
                release.resolve();
                await expect(pending).rejects.toThrow();
                await expect(manager.getDocument(afterIndex, product.id.toString())).resolves.toBeNull();
                expect(await manager.getActiveAliasTargets()).toEqual({ read: [afterIndex], write: [afterIndex] });
            } finally {
                release.resolve();
                await Promise.allSettled([pending]);
                writeSpy.mockRestore();
                executeSpy.mockRestore();
            }
        },
        60_000
    );
});

async function createOrm(
    connection: ReturnType<typeof readMySqlIntegrationConnection>,
    max: number,
    contextName?: string
) {
    return MikroORM.init<MySqlDriver>({
        driver: MySqlDriver,
        entities: [...databaseEntities],
        metadataProvider: ReflectMetadataProvider,
        ...connection,
        ensureDatabase: false,
        forceUtcTimezone: true,
        debug: false,
        pool: { min: 0, max },
        ...(contextName ? { contextName } : {}),
    });
}

async function awaitLatch(latch: Promise<void>, rebuild: Promise<unknown>): Promise<void> {
    return Promise.race([
        latch,
        rebuild.then(() => {
            throw new Error('Rebuild completed before reaching the cutover latch');
        }),
    ]);
}

async function createActiveProduct(orm: CoreMikroORM<MySqlDriver>, suffix: string) {
    const em = orm.em.fork({ useContext: true });
    const seller = Object.assign(new MemberEntity(), {
        name: 'Recovery Seller',
        email: `recovery-${suffix}@example.com`,
        hashedPassword: null,
        phone: '010-0000-2000',
        role: MemberRole.SELLER,
        lastLoginAt: null,
        membershipAt: null,
        deletedAt: null,
    });
    em.persist(seller);
    await em.flush();
    const commands = new ProductCommandService(em);
    const actor = { memberId: seller.id, role: MemberRole.SELLER };
    const created = await commands.create(actor, { slug: `recovery-${suffix}`, name: '복구 대상 상품' });
    const replaced = await commands.replaceCatalog(actor, {
        productId: created.productId,
        expectedRevision: created.revision,
        options: [],
        categoryIds: [],
        tags: ['recovery'],
        items: [
            {
                sku: `RECOVERY-${suffix}`,
                name: '기본 품목',
                supplyPrice: '10000',
                vat: '1000',
                isTaxFree: false,
                saleStatus: ItemSaleStatus.ALLOW,
                selectedOptions: [],
            },
        ],
    });
    const active = await commands.update(actor, {
        productId: created.productId,
        expectedRevision: replaced.revision,
        status: ProductStatus.ACTIVE,
    });
    return { commands, actor, id: created.productId, revision: active.revision };
}
