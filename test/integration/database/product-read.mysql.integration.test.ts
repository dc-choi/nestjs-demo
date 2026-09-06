import { type MikroORM as CoreMikroORM, type EntityManager } from '@mikro-orm/core';
import { ReflectMetadataProvider } from '@mikro-orm/decorators/legacy';
import { MikroORM, MySqlDriver } from '@mikro-orm/mysql';

import { randomUUID } from 'node:crypto';
import {
    readMySqlIntegrationConnection,
    seedCatalogMaintenance,
} from 'test/integration/database/mysql-integration.config';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductCommandService } from '~/api/catalog/application/product-command.service';
import type { ReplaceProductCatalogCommand } from '~/api/catalog/application/product-write.command';
import { ProductService } from '~/api/catalog/application/product.service';
import { CategoryEntity } from '~/api/catalog/domain/entity/category.entity';
import { ItemSaleStatus } from '~/api/catalog/domain/entity/item-sale-status';
import { ItemEntity } from '~/api/catalog/domain/entity/item.entity';
import { ProductStatus } from '~/api/catalog/domain/entity/product-status';
import { ProductEntity } from '~/api/catalog/domain/entity/product.entity';
import { MemberRole } from '~/api/member/domain/member-role';
import { MemberEntity } from '~/api/member/domain/member.entity';
import type { JwtPayload } from '~/global/jwt/payload/jwt.payload';
import { databaseEntities } from '~/infra/database/entities';

const describeMySql = process.env.MYSQL_INTEGRATION === '1' ? describe : describe.skip;

interface CatalogFixture {
    actor: JwtPayload;
    productId: bigint;
    revision: number;
    name: string;
    tags: string[];
    catalog: Omit<ReplaceProductCatalogCommand, 'expectedRevision' | 'productId'>;
}

describeMySql('Product read MySQL integration', () => {
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
    });

    beforeEach(async () => {
        await orm!.schema.clear();
        await seedCatalogMaintenance(orm!.em.fork());
    });

    afterAll(async () => {
        await orm?.close(true);
    });

    it('large catalog collections avoid join multiplication and retain one MySQL snapshot across child loads', async () => {
        const fixture = await createFixture(orm!.em.fork());
        const connection = orm!.em.getConnection();
        const execute = connection.execute.bind(connection);
        const readRowCounts: number[] = [];
        let rootQuerySeen = false;
        let childQuerySeen = false;
        let readTransaction: unknown;
        let concurrentWrite: Promise<void> | undefined;

        const executeSpy = vi.spyOn(connection, 'execute').mockImplementation(async (query, params, method, ctx) => {
            const result = await execute(query, params, method, ctx);
            const sql = typeof query === 'string' ? query : '';

            if (!rootQuerySeen && isCurrentProductRootQuery(sql)) {
                rootQuerySeen = true;
                readTransaction = ctx;
                concurrentWrite = replaceCatalogAfterRootRead(orm!, fixture);
                await concurrentWrite;
            } else if (rootQuerySeen && ctx === readTransaction && isSelectQuery(sql)) {
                childQuerySeen = true;
            }

            if (ctx === readTransaction && isSelectQuery(sql)) {
                const rowCount = queryRowCount(result);
                if (rowCount !== undefined) readRowCounts.push(rowCount);
            }

            return result;
        });

        try {
            const current = await new ProductService(orm!.em.fork().getRepository(ProductEntity)).findCurrentById(
                fixture.productId
            );

            expect(rootQuerySeen).toBe(true);
            expect(childQuerySeen).toBe(true);
            await expect(concurrentWrite).resolves.toBeUndefined();
            expect(current).not.toBeNull();

            const product = current!;
            expect(product).toMatchObject({
                id: fixture.productId,
                revision: fixture.revision,
                name: fixture.name,
                tags: fixture.tags,
            });
            expect(product.categories).toHaveLength(2);
            expect(product.options).toHaveLength(2);
            expect(product.options.map(({ values }) => values)).toEqual([expect.any(Array), expect.any(Array)]);
            expect(product.options.every(({ values }) => values.length === 10)).toBe(true);
            expect(product.items).toHaveLength(100);
            expect(product.items.map(({ sequence }) => sequence)).toEqual([...Array(100).keys()]);
            expect(product.items.every(({ selectedOptions }) => selectedOptions.length === 2)).toBe(true);
            expect(product.items[73]).toMatchObject({
                sku: expect.stringContaining('-073'),
                selectedOptions: [
                    { optionCode: 'tone', valueCode: 'tone-3' },
                    { optionCode: 'size', valueCode: 'size-7' },
                ],
            });

            expect(readRowCounts).not.toHaveLength(0);
            expect(Math.max(...readRowCounts)).toBeLessThanOrEqual(200);
        } finally {
            executeSpy.mockRestore();
        }
    }, 30_000);
});

async function createFixture(em: EntityManager): Promise<CatalogFixture> {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
    const seller = Object.assign(new MemberEntity(), {
        name: 'Product Read Integration Seller',
        email: `product-read-${suffix}@example.com`,
        hashedPassword: null,
        phone: '010-0000-2000',
        role: MemberRole.SELLER,
        lastLoginAt: null,
        membershipAt: null,
        deletedAt: null,
    });
    const categories = [0, 1].map((sequence) =>
        Object.assign(new CategoryEntity(), {
            name: `Product Read Category ${sequence}`,
            slug: `product-read-category-${sequence}-${suffix}`,
            sequence,
            isActive: true,
            deletedAt: null,
            parent: null,
        })
    );
    em.persist([seller, ...categories]);
    await em.flush();

    const actor = { memberId: seller.id, role: MemberRole.SELLER };
    const commands = new ProductCommandService(em);
    const name = 'Large Current Product';
    const tags = ['stable-tag', 'core-tag'];
    const catalog: Omit<ReplaceProductCatalogCommand, 'expectedRevision' | 'productId'> = {
        options: ['tone', 'size'].map((code) => ({
            code,
            name: code === 'tone' ? 'Tone' : 'Size',
            isRequired: true,
            values: [...Array(10).keys()].map((index) => ({
                code: `${code}-${index}`,
                name: `${code} ${index}`,
            })),
        })),
        items: [...Array(100).keys()].map((index) => ({
            sku: `MYSQL-PRODUCT-READ-${suffix}-${String(index).padStart(3, '0')}`,
            name: `Integration Item ${index}`,
            supplyPrice: '10000',
            vat: '1000',
            isTaxFree: false,
            saleStatus: ItemSaleStatus.ALLOW,
            selectedOptions: [
                { optionCode: 'tone', valueCode: `tone-${index % 10}` },
                { optionCode: 'size', valueCode: `size-${Math.floor(index / 10)}` },
            ],
        })),
        categoryIds: categories.map(({ id }) => id),
        tags,
        reason: 'MYSQL_INTEGRATION_PRODUCT_READ_FIXTURE',
    };
    const created = await commands.create(actor, {
        slug: `large-current-product-${suffix}`,
        name,
    });
    const replaced = await commands.replaceCatalog(actor, {
        productId: created.productId,
        expectedRevision: created.revision,
        ...catalog,
    });
    const activated = await commands.update(actor, {
        productId: created.productId,
        expectedRevision: replaced.revision,
        status: ProductStatus.ACTIVE,
    });

    const currentItems = await em.find(ItemEntity, { product: created.productId });
    const idBySku = new Map(currentItems.map((item) => [item.sku, item.id]));
    return {
        actor,
        productId: created.productId,
        revision: activated.revision,
        name,
        tags,
        catalog: { ...catalog, items: catalog.items.map((item) => ({ ...item, id: idBySku.get(item.sku!)! })) },
    };
}

async function replaceCatalogAfterRootRead(orm: CoreMikroORM<MySqlDriver>, fixture: CatalogFixture): Promise<void> {
    const commands = new ProductCommandService(orm.em.fork());
    await commands.replaceCatalog(fixture.actor, {
        productId: fixture.productId,
        expectedRevision: fixture.revision,
        ...fixture.catalog,
        tags: ['changed-after-root-read', fixture.tags[1]],
        reason: 'MYSQL_INTEGRATION_PRODUCT_READ_CONCURRENT_REPLACE',
    });
}

function isCurrentProductRootQuery(query: string): boolean {
    return /from `products` as `p\d+`/i.test(query) && /`p\d+`\.`id` = \?/i.test(query);
}

function isSelectQuery(query: string): boolean {
    return /^select /i.test(query.trim());
}

function queryRowCount(result: unknown): number | undefined {
    return Array.isArray(result) ? result.length : undefined;
}
