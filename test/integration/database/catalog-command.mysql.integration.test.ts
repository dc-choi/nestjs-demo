import type { MikroORM as CoreMikroORM, EntityManager } from '@mikro-orm/core';
import { ReflectMetadataProvider } from '@mikro-orm/decorators/legacy';
import { MikroORM, MySqlDriver } from '@mikro-orm/mysql';

import { randomUUID } from 'node:crypto';
import {
    readMySqlIntegrationConnection,
    seedCatalogMaintenance,
} from 'test/integration/database/mysql-integration.config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ProductCommandService } from '~/api/catalog/application/product-command.service';
import { ProductService } from '~/api/catalog/application/product.service';
import { CategoryEntity } from '~/api/catalog/domain/entity/category.entity';
import { ItemOptionValueEntity } from '~/api/catalog/domain/entity/item-option-value.entity';
import { ItemSaleStatus } from '~/api/catalog/domain/entity/item-sale-status';
import { ProductSnapshotEntity } from '~/api/catalog/domain/entity/product-snapshot.entity';
import { ProductStatus } from '~/api/catalog/domain/entity/product-status';
import { ProductEntity } from '~/api/catalog/domain/entity/product.entity';
import { MemberRole } from '~/api/member/domain/member-role';
import { MemberEntity } from '~/api/member/domain/member.entity';
import { databaseEntities } from '~/infra/database/entities';

const describeMySql = process.env.MYSQL_INTEGRATION === '1' ? describe : describe.skip;

describeMySql('Catalog command MySQL integration', () => {
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
            pool: { min: 0, max: 2 },
        });
        await seedCatalogMaintenance(orm.em.fork());
    });

    afterAll(async () => {
        await orm?.close(true);
    });

    it('2개 옵션과 2개 Item을 교체하고 live 조회와 Snapshot을 다시 읽는다', async () => {
        const em = orm!.em.fork();
        let productId: bigint | undefined;
        await em.begin();

        try {
            productId = await verifyCatalogRoundTrip(em);
        } finally {
            if (em.isInTransaction()) await em.rollback();
        }

        expect(await orm!.em.fork().count(ProductEntity, { id: productId })).toBe(0);
    });
});

async function verifyCatalogRoundTrip(em: EntityManager): Promise<bigint> {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
    const blackSku = `INTEGRATION-BLACK-RED-${suffix}`;
    const whiteSku = `INTEGRATION-WHITE-BROWN-${suffix}`;
    const seller = Object.assign(new MemberEntity(), {
        name: 'Catalog Integration Seller',
        email: `catalog-${suffix}@example.com`,
        hashedPassword: null,
        phone: '010-0000-1000',
        role: MemberRole.SELLER,
        lastLoginAt: null,
        membershipAt: null,
        deletedAt: null,
    });
    const category = Object.assign(new CategoryEntity(), {
        name: 'Integration Keyboards',
        slug: `integration-keyboards-${suffix}`,
        sequence: 0,
        isActive: true,
        deletedAt: null,
        parent: null,
    });
    em.persist([seller, category]);
    await em.flush();

    const actor = { memberId: seller.id, role: MemberRole.SELLER };
    const commandService = new ProductCommandService(em);
    const created = await commandService.create(actor, {
        slug: `integration-wireless-keyboard-${suffix}`,
        name: 'Integration Wireless Keyboard',
    });
    const replaced = await commandService.replaceCatalog(actor, {
        productId: created.productId,
        expectedRevision: created.revision,
        options: [
            {
                code: 'color',
                name: 'Color',
                isRequired: true,
                values: [
                    { code: 'black', name: 'Black' },
                    { code: 'white', name: 'White' },
                ],
            },
            {
                code: 'switch',
                name: 'Switch',
                isRequired: true,
                values: [
                    { code: 'red', name: 'Red' },
                    { code: 'brown', name: 'Brown' },
                ],
            },
        ],
        items: [
            {
                sku: blackSku,
                name: 'Black, Red Switch',
                supplyPrice: '80000',
                vat: '8000',
                isTaxFree: false,
                saleStatus: ItemSaleStatus.ALLOW,
                selectedOptions: [
                    { optionCode: 'color', valueCode: 'black' },
                    { optionCode: 'switch', valueCode: 'red' },
                ],
            },
            {
                sku: whiteSku,
                name: 'White, Brown Switch',
                supplyPrice: '90000',
                vat: '9000',
                isTaxFree: false,
                saleStatus: ItemSaleStatus.ALLOW,
                selectedOptions: [
                    { optionCode: 'color', valueCode: 'white' },
                    { optionCode: 'switch', valueCode: 'brown' },
                ],
            },
        ],
        categoryIds: [category.id],
        tags: ['keyboard', 'wireless'],
        reason: 'MYSQL_INTEGRATION_REPLACE',
    });
    await commandService.update(actor, {
        productId: created.productId,
        expectedRevision: replaced.revision,
        status: ProductStatus.ACTIVE,
    });

    const selections = await em.find(
        ItemOptionValueEntity,
        { productId: created.productId },
        { populate: ['item', 'option', 'value'] }
    );
    const current = await new ProductService(em.getRepository(ProductEntity)).findCurrentById(created.productId);
    const snapshot = await em.findOneOrFail(ProductSnapshotEntity, {
        product: created.productId,
        revision: replaced.revision,
    });

    expect(selections).toHaveLength(4);
    expect(selections.every(({ productId, option }) => productId === created.productId && option.id > 0n)).toBe(true);
    expect(current).toMatchObject({
        id: created.productId,
        revision: 3,
        tags: ['keyboard', 'wireless'],
        items: [
            { sku: blackSku, price: { amount: '88000' }, selectedOptions: expect.any(Array) },
            { sku: whiteSku, price: { amount: '99000' }, selectedOptions: expect.any(Array) },
        ],
        options: [{ code: 'color' }, { code: 'switch' }],
        categories: [{ id: category.id, slug: category.slug }],
    });
    expect(current?.items.map(({ selectedOptions }) => selectedOptions)).toEqual([
        [
            expect.objectContaining({ optionCode: 'color', valueCode: 'black' }),
            expect.objectContaining({ optionCode: 'switch', valueCode: 'red' }),
        ],
        [
            expect.objectContaining({ optionCode: 'color', valueCode: 'white' }),
            expect.objectContaining({ optionCode: 'switch', valueCode: 'brown' }),
        ],
    ]);
    expect(snapshot).toMatchObject({
        revision: 2,
        reason: 'MYSQL_INTEGRATION_REPLACE',
        payload: {
            items: [{ sku: blackSku }, { sku: whiteSku }],
            options: [{ code: 'color' }, { code: 'switch' }],
            tags: [{ value: 'keyboard' }, { value: 'wireless' }],
        },
    });
    snapshot.payload.items.forEach((item) => expect(item).not.toHaveProperty('stock'));
    return created.productId;
}
