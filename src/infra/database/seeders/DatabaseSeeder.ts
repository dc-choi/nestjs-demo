import { type EntityManager, LockMode } from '@mikro-orm/core';
import { Seeder } from '@mikro-orm/seeder';

import { ProductCommandService } from '~/api/catalog/application/product-command.service';
import { CategoryEntity } from '~/api/catalog/domain/entity/category.entity';
import { ItemSaleStatus } from '~/api/catalog/domain/entity/item-sale-status';
import { ItemEntity } from '~/api/catalog/domain/entity/item.entity';
import { ProductStatus } from '~/api/catalog/domain/entity/product-status';
import { ProductEntity } from '~/api/catalog/domain/entity/product.entity';
import { InventoryMovementEntity } from '~/api/inventory/domain/inventory-movement.entity';
import { InventoryMovementType } from '~/api/inventory/domain/inventory.enum';
import { MemberRole } from '~/api/member/domain/member-role';
import { MemberDomain } from '~/api/member/domain/member.domain';
import { MemberEntity } from '~/api/member/domain/member.entity';
import type { JwtPayload } from '~/global/jwt/payload/jwt.payload';

const DEMO_PRODUCT_SLUG = 'demo-wireless-keyboard';
const initialStockBySku = new Map([
    ['DEMO-KEYBOARD-BLACK-RED', 25],
    ['DEMO-KEYBOARD-WHITE-BROWN', 15],
]);

const demoMembers = [
    {
        email: 'admin@demo-nest.local',
        name: 'Demo Admin',
        phone: '010-0000-0001',
        role: MemberRole.ADMIN,
    },
    {
        email: 'seller@demo-nest.local',
        name: 'Demo Seller',
        phone: '010-0000-0002',
        role: MemberRole.SELLER,
    },
    {
        email: 'customer@demo-nest.local',
        name: 'Demo Customer',
        phone: '010-0000-0003',
        role: MemberRole.CUSTOMER,
    },
] as const;

export class DatabaseSeeder extends Seeder {
    async run(em: EntityManager): Promise<void> {
        const password = requireSeedEnvironment('DEMO_SEED_PASSWORD');
        const members = await seedMembers(em, password);
        const keyboardCategory = await seedCategories(em);
        const seller = requireMember(members, MemberRole.SELLER);
        const sellerActor: JwtPayload = { memberId: seller.id, role: seller.role };

        await seedCatalog(em, sellerActor, keyboardCategory);
        await seedInventory(em, sellerActor);
    }
}

async function seedMembers(em: EntityManager, password: string): Promise<MemberEntity[]> {
    const members: MemberEntity[] = [];
    for (const definition of demoMembers) {
        let member = await em.findOne(MemberEntity, { email: definition.email }, { connectionType: 'write' });
        if (!member) {
            member = Object.assign(new MemberEntity(), {
                ...definition,
                hashedPassword: await MemberDomain.hashPassword(password),
                lastLoginAt: null,
                membershipAt: null,
                deletedAt: null,
            });
            em.persist(member);
        }
        members.push(member);
    }
    await em.flush();
    return members;
}

async function seedCategories(em: EntityManager): Promise<CategoryEntity> {
    let root = await em.findOne(CategoryEntity, { slug: 'electronics' }, { connectionType: 'write' });
    if (!root) {
        root = Object.assign(new CategoryEntity(), {
            name: 'Electronics',
            slug: 'electronics',
            sequence: 0,
            isActive: true,
            deletedAt: null,
            parent: null,
        });
        em.persist(root);
        await em.flush();
    }

    let keyboards = await em.findOne(CategoryEntity, { slug: 'keyboards' }, { connectionType: 'write' });
    if (!keyboards) {
        keyboards = Object.assign(new CategoryEntity(), {
            name: 'Keyboards',
            slug: 'keyboards',
            sequence: 0,
            isActive: true,
            deletedAt: null,
            parent: root,
        });
        em.persist(keyboards);
        await em.flush();
    }
    return keyboards;
}

async function seedCatalog(em: EntityManager, seller: JwtPayload, category: CategoryEntity): Promise<void> {
    const service = new ProductCommandService(em);
    let product = await em.findOne(ProductEntity, { slug: DEMO_PRODUCT_SLUG }, { connectionType: 'write' });
    if (!product) {
        const created = await service.create(seller, {
            slug: DEMO_PRODUCT_SLUG,
            name: 'Demo Wireless Keyboard',
            description: 'Search, ordering, payment, inventory, and fulfillment practice product.',
            returnPolicy: 'Returns are accepted within seven days for this local demo.',
            reason: 'DEMO_SEED_CREATE',
        });
        product = await requireSeedProduct(em, created.productId);
    }

    const itemCount = await em.count(ItemEntity, { product, deletedAt: null }, { connectionType: 'write' });
    if (itemCount === 0) {
        const catalog = await service.replaceCatalog(seller, {
            productId: product.id,
            expectedRevision: product.revision,
            options: demoOptions,
            items: demoItems,
            categoryIds: [category.id],
            tags: ['keyboard', 'wireless'],
            reason: 'DEMO_SEED_CATALOG',
        });
        product = await requireSeedProduct(em, catalog.productId);
    } else if (itemCount !== demoItems.length) {
        throw new Error(`Seed product ${DEMO_PRODUCT_SLUG} contains an unexpected catalog graph`);
    }

    if (product.status !== ProductStatus.ACTIVE) {
        await service.update(seller, {
            productId: product.id,
            expectedRevision: product.revision,
            status: ProductStatus.ACTIVE,
            reason: 'DEMO_SEED_ACTIVATE',
        });
    }
}

const demoOptions = [
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
] as const;

const demoItems = [
    {
        sku: 'DEMO-KEYBOARD-BLACK-RED',
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
        sku: 'DEMO-KEYBOARD-WHITE-BROWN',
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
] as const;

async function requireSeedProduct(em: EntityManager, productId: bigint): Promise<ProductEntity> {
    const product = await em.findOne(ProductEntity, { id: productId }, { connectionType: 'write', refresh: true });
    if (!product) throw new Error(`Seed product ${productId} is unavailable after creation`);
    return product;
}

async function seedInventory(em: EntityManager, seller: JwtPayload): Promise<void> {
    if (seller.role !== MemberRole.SELLER) throw new Error('Demo inventory seed requires the seller actor');

    await em.transactional(async (tx) => {
        const product = await tx.findOne(ProductEntity, { slug: DEMO_PRODUCT_SLUG }, { connectionType: 'write' });
        if (!product) throw new Error(`Seed product ${DEMO_PRODUCT_SLUG} was not created`);

        const items = await tx.find(
            ItemEntity,
            { product, deletedAt: null },
            { connectionType: 'write', lockMode: LockMode.PESSIMISTIC_WRITE }
        );
        if (items.length !== demoItems.length) {
            throw new Error(`Seed product ${DEMO_PRODUCT_SLUG} must contain exactly ${demoItems.length} items`);
        }

        for (const item of items) await seedItemInventory(tx, item);
    });
}

async function seedItemInventory(em: EntityManager, item: ItemEntity): Promise<void> {
    const quantityDelta = initialStockBySku.get(item.sku);
    if (quantityDelta === undefined) throw new Error(`Unexpected demo seed SKU: ${item.sku}`);
    const idempotencyKey = `demo-seed-initial-stock:${item.sku}`;
    const existing = await em.findOne(InventoryMovementEntity, { item, idempotencyKey });
    if (existing) {
        if (
            existing.type !== InventoryMovementType.RECEIPT ||
            existing.quantityDelta !== quantityDelta ||
            existing.reason !== 'DEMO_SEED_INITIAL_STOCK'
        ) {
            throw new Error(`Seed inventory key ${idempotencyKey} is already used by another movement`);
        }
        return;
    }

    item.stock += quantityDelta;
    em.persist(
        InventoryMovementEntity.record({
            item,
            type: InventoryMovementType.RECEIPT,
            quantityDelta,
            stockAfter: item.stock,
            idempotencyKey,
            reason: 'DEMO_SEED_INITIAL_STOCK',
        })
    );
}

function requireMember(members: readonly MemberEntity[], role: MemberRole): MemberEntity {
    const member = members.find((candidate) => candidate.role === role);
    if (!member) throw new Error(`Demo seed member with role ${role} is unavailable`);
    return member;
}

function requireSeedEnvironment(name: 'DEMO_SEED_PASSWORD'): string {
    const value = process.env[name];
    if (!value || value.length < 8) throw new Error(`${name} must contain at least eight characters`);
    return value;
}
