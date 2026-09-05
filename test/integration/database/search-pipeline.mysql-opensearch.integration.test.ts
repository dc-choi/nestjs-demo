import { type MikroORM as CoreMikroORM } from '@mikro-orm/core';
import { ReflectMetadataProvider } from '@mikro-orm/decorators/legacy';
import { MikroORM, MySqlDriver } from '@mikro-orm/mysql';

import { randomUUID } from 'node:crypto';
import { readMySqlIntegrationConnection } from 'test/integration/database/mysql-integration.config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ProductCommandService } from '~/api/catalog/application/product-command.service';
import { ItemSaleStatus } from '~/api/catalog/domain/entity/item-sale-status';
import { ProductStatus } from '~/api/catalog/domain/entity/product-status';
import { MemberRole } from '~/api/member/domain/member-role';
import { MemberEntity } from '~/api/member/domain/member.entity';
import { databaseEntities } from '~/infra/database/entities';
import { createCatalogIndexName } from '~/infra/search/catalog-index.definition';
import { CatalogIndexManager } from '~/infra/search/catalog-index.manager';
import { CatalogProjectionReader } from '~/infra/search/catalog-projection.reader';
import { CatalogRebuildService } from '~/infra/search/catalog-rebuild.service';
import { CatalogSearchWorker } from '~/infra/search/catalog-search.worker';
import { OpenSearchHttpClient } from '~/infra/search/opensearch.client';
import { SearchOutboxRelay } from '~/infra/search/search-outbox.relay';
import { SearchReconciliationService } from '~/infra/search/search-reconciliation.service';
import { SearchConfig } from '~/infra/search/search.config';

const enabled = process.env.MYSQL_INTEGRATION === '1' && process.env.OPENSEARCH_INTEGRATION === '1';
const describePipeline = enabled ? describe : describe.skip;

describePipeline('MySQL to OpenSearch catalog pipeline integration', () => {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
    const config = {
        enabled: true,
        nodeUrl: new URL(process.env.OPENSEARCH_NODE_URL ?? 'http://127.0.0.1:9200'),
        readAlias: `catalog-pipeline-read-${suffix}`,
        writeAlias: `catalog-pipeline-write-${suffix}`,
        cursorSecret: 'integration-test-cursor-secret-at-least-32',
        requestTimeoutMs: 5_000,
    } as SearchConfig;
    const client = new OpenSearchHttpClient(config);
    const manager = new CatalogIndexManager(client, config);
    let orm: CoreMikroORM<MySqlDriver> | undefined;
    let indexName: string | undefined;

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
    }, 60_000);

    afterAll(async () => {
        try {
            if (indexName) await manager.deleteIndex(indexName);
        } finally {
            if (orm) {
                try {
                    await orm.schema.clear();
                } finally {
                    await orm.close(true);
                }
            }
        }
    });

    it('rebuilds, relays a committed catalog change and reconciles with no differences', async () => {
        const em = orm!.em.fork({ useContext: true });
        const seller = Object.assign(new MemberEntity(), {
            name: 'Search Pipeline Seller',
            email: `search-pipeline-${suffix}@example.com`,
            hashedPassword: null,
            phone: '010-0000-2000',
            role: MemberRole.SELLER,
            lastLoginAt: null,
            membershipAt: null,
            deletedAt: null,
        });
        em.persist(seller);
        await em.flush();

        const catalog = new ProductCommandService(em);
        const actor = { memberId: seller.id, role: MemberRole.SELLER };
        const created = await catalog.create(actor, {
            slug: `search-pipeline-${suffix}`,
            name: '검색 파이프라인 상품',
        });
        const replaced = await catalog.replaceCatalog(actor, {
            productId: created.productId,
            expectedRevision: created.revision,
            options: [],
            items: [
                {
                    sku: `SEARCH-PIPELINE-${suffix}`,
                    name: '기본 품목',
                    supplyPrice: '10000',
                    vat: '1000',
                    isTaxFree: false,
                    saleStatus: ItemSaleStatus.ALLOW,
                    selectedOptions: [],
                },
            ],
            categoryIds: [],
            tags: ['pipeline'],
        });
        const activated = await catalog.update(actor, {
            productId: created.productId,
            expectedRevision: replaced.revision,
            status: ProductStatus.ACTIVE,
        });

        const reader = new CatalogProjectionReader(orm!);
        const rebuild = new CatalogRebuildService(config, reader, manager);
        const worker = new CatalogSearchWorker(config, reader, manager);
        const relay = new SearchOutboxRelay(orm!, worker, config);
        const reconciliation = new SearchReconciliationService(config, reader, manager, worker);
        const buildId = `pipeline-${suffix}`;
        indexName = createCatalogIndexName(buildId);
        const rebuilt = await rebuild.rebuild({ buildId, batchSize: 10 });
        expect(rebuilt.indexName).toBe(indexName);
        expect(rebuilt).toMatchObject({ indexedDocuments: 1, activated: true });

        const updated = await catalog.update(actor, {
            productId: created.productId,
            expectedRevision: activated.revision,
            name: '검색 파이프라인 수정 상품',
        });
        const drained = await relay.drainUntilEmpty();
        expect(drained.failed).toBe(0);
        expect(drained.processed).toBeGreaterThanOrEqual(1);

        await manager.refresh(config.readAlias);
        await expect(manager.getDocument(config.readAlias, created.productId.toString())).resolves.toMatchObject({
            version: updated.revision,
            source: { name: '검색 파이프라인 수정 상품' },
        });
        await expect(reconciliation.reconcile()).resolves.toMatchObject({
            differenceCount: 0,
            repairedCount: 0,
        });
    }, 60_000);
});
