import { Collection, EntityManager, LockMode } from '@mikro-orm/core';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';

import { describe, expect, it, vi } from 'vitest';
import { ProductCommandService } from '~/api/catalog/application/product-command.service';
import { CategoryEntity } from '~/api/catalog/domain/entity/category.entity';
import { ItemOptionValueEntity } from '~/api/catalog/domain/entity/item-option-value.entity';
import { ItemSaleStatus } from '~/api/catalog/domain/entity/item-sale-status';
import { ItemEntity } from '~/api/catalog/domain/entity/item.entity';
import { ProductOptionValueEntity } from '~/api/catalog/domain/entity/product-option-value.entity';
import { ProductOptionEntity } from '~/api/catalog/domain/entity/product-option.entity';
import { ProductSnapshotChangeType } from '~/api/catalog/domain/entity/product-snapshot-change-type';
import type { ProductSnapshotPayload } from '~/api/catalog/domain/entity/product-snapshot-payload';
import { ProductSnapshotEntity } from '~/api/catalog/domain/entity/product-snapshot.entity';
import { ProductStatus } from '~/api/catalog/domain/entity/product-status';
import { ProductEntity } from '~/api/catalog/domain/entity/product.entity';
import { createProductSnapshotPayload } from '~/api/catalog/domain/product-snapshot.factory';
import { MemberRole } from '~/api/member/domain/member-role';
import { MemberEntity } from '~/api/member/domain/member.entity';
import type { JwtPayload } from '~/global/jwt/payload/jwt.payload';
import { SearchProjectionOutboxEntity } from '~/infra/search/search-projection-outbox.entity';

const seller: JwtPayload = { memberId: 7n, role: MemberRole.SELLER };

describe('ProductCommandService', () => {
    it('상품과 revision 1 Snapshot, 검색 outbox를 하나의 transaction에 생성한다', async () => {
        const harness = createHarness({ assignCreatedProductId: 101n });
        const service = new ProductCommandService(harness.em);

        const result = await service.create(seller, {
            slug: 'basic-shirt',
            name: '  기본 셔츠  ',
            description: '  상품 설명  ',
            reason: '  초안  ',
        });

        expect(result).toEqual({
            productId: 101n,
            revision: 1,
            status: ProductStatus.DRAFT,
            deletedAt: null,
        });
        expect(harness.transactional).toHaveBeenCalledTimes(1);
        expect(harness.flush).toHaveBeenCalledTimes(2);

        const snapshot = persistedOf(ProductSnapshotEntity, harness.persisted);
        expect(snapshot).toMatchObject({
            revision: 1,
            schemaVersion: 1,
            changeType: ProductSnapshotChangeType.CREATE,
            reason: '초안',
            payload: {
                product: {
                    id: '101',
                    sellerId: '7',
                    slug: 'basic-shirt',
                    name: '기본 셔츠',
                    description: '상품 설명',
                    status: ProductStatus.DRAFT,
                },
                items: [],
            },
        });
        expect(persistedOf(SearchProjectionOutboxEntity, harness.persisted)).toMatchObject({
            product: snapshot.product,
            productRevision: 1,
        });
    });

    it('Product row를 잠그고 expectedRevision이 일치할 때 revision과 Snapshot을 같이 올린다', async () => {
        const product = createProduct({ revision: 4 });
        const harness = createHarness({ product });
        const service = new ProductCommandService(harness.em);

        const result = await service.update(seller, {
            productId: product.id,
            expectedRevision: 4,
            name: '새 이름',
            reason: '상품명 교체',
        });

        expect(harness.findOne).toHaveBeenNthCalledWith(
            1,
            ProductEntity,
            { id: product.id },
            { lockMode: LockMode.PESSIMISTIC_WRITE }
        );
        expect(result.revision).toBe(5);
        expect(product.name).toBe('새 이름');

        const snapshot = persistedOf(ProductSnapshotEntity, harness.persisted);
        expect(snapshot).toMatchObject({
            revision: 5,
            changeType: ProductSnapshotChangeType.UPDATE,
            reason: '상품명 교체',
            payload: { product: { name: '새 이름' } },
        });
        expect(persistedOf(SearchProjectionOutboxEntity, harness.persisted).productRevision).toBe(5);
    });

    it('row lock 후 expectedRevision 불일치를 감지하고 쓰기를 남기지 않는다', async () => {
        const product = createProduct({ revision: 5 });
        const harness = createHarness({ product });
        const service = new ProductCommandService(harness.em);

        await expect(
            service.update(seller, { productId: product.id, expectedRevision: 4, name: '다른 이름' })
        ).rejects.toBeInstanceOf(ConflictException);

        expect(harness.rolledBack()).toBe(true);
        expect(harness.persisted).toHaveLength(0);
        expect(harness.flush).not.toHaveBeenCalled();
    });

    it('판매자가 다른 판매자의 상품을 변경하지 못하게 한다', async () => {
        const product = createProduct({ sellerId: 8n });
        const harness = createHarness({ product });
        const service = new ProductCommandService(harness.em);

        await expect(
            service.update(seller, { productId: product.id, expectedRevision: product.revision, name: '탈인 상품' })
        ).rejects.toBeInstanceOf(ForbiddenException);

        expect(harness.persisted).toHaveLength(0);
    });

    it('관리자는 다른 판매자의 정지된 상품도 감사 주체를 남기며 변경할 수 있다', async () => {
        const product = createProduct({ sellerId: 8n, status: ProductStatus.SUSPENDED });
        const harness = createHarness({ product });
        const service = new ProductCommandService(harness.em);
        const admin: JwtPayload = { memberId: 99n, role: MemberRole.ADMIN };

        await expect(
            service.update(admin, {
                productId: product.id,
                expectedRevision: product.revision,
                name: '관리자 수정 상품',
            })
        ).resolves.toMatchObject({ revision: 2, status: ProductStatus.SUSPENDED });

        expect(persistedOf(ProductSnapshotEntity, harness.persisted).changedBy).toMatchObject({ id: admin.memberId });
    });

    it('ACTIVE로 변경할 때 판매 가능한 Item이 없으면 transaction을 rollback한다', async () => {
        const product = createProduct();
        const harness = createHarness({ product });
        const service = new ProductCommandService(harness.em);

        await expect(
            service.update(seller, {
                productId: product.id,
                expectedRevision: product.revision,
                status: ProductStatus.ACTIVE,
            })
        ).rejects.toBeInstanceOf(BadRequestException);

        expect(harness.rolledBack()).toBe(true);
        expect(harness.persisted).toHaveLength(0);
    });

    it('soft delete 상태와 DELETE Snapshot, 검색 outbox를 같은 revision으로 저장한다', async () => {
        const product = createProduct({ revision: 2, status: ProductStatus.PAUSED });
        const harness = createHarness({ product });
        const service = new ProductCommandService(harness.em);

        const result = await service.delete(seller, {
            productId: product.id,
            expectedRevision: 2,
            reason: '판매 종료',
        });

        expect(result.revision).toBe(3);
        expect(result.status).toBe(ProductStatus.CLOSED);
        expect(result.deletedAt).toBeInstanceOf(Date);
        expect(persistedOf(ProductSnapshotEntity, harness.persisted)).toMatchObject({
            revision: 3,
            changeType: ProductSnapshotChangeType.DELETE,
        });
        expect(persistedOf(SearchProjectionOutboxEntity, harness.persisted).productRevision).toBe(3);
    });

    it('하나의 aggregate 명령으로 Item 생성/수정/soft delete와 옵션, 태그를 교체한다', async () => {
        const product = createProduct({ revision: 6 });
        const { option, blackItem, whiteItem } = attachCatalogGraph(product);
        const categoryRoot = Object.assign(new CategoryEntity(), {
            id: 90n,
            name: '의류',
            slug: 'clothing',
            parent: null,
        });
        const category = Object.assign(new CategoryEntity(), {
            id: 91n,
            name: '상의',
            slug: 'tops',
            parent: categoryRoot,
        });
        const harness = createHarness({ product, categories: [category] });
        const service = new ProductCommandService(harness.em);

        const result = await service.replaceCatalog(seller, {
            productId: product.id,
            expectedRevision: 6,
            options: [
                {
                    code: 'color',
                    name: '색상',
                    isRequired: true,
                    values: [
                        { code: 'black', name: '검정' },
                        { code: 'white', name: '하양' },
                    ],
                },
            ],
            items: [
                {
                    id: blackItem.id,
                    sku: blackItem.sku,
                    name: '검정 셔츠 수정',
                    supplyPrice: '10000',
                    vat: '1000',
                    isTaxFree: false,
                    saleStatus: ItemSaleStatus.ALLOW,
                    selectedOptions: [{ optionCode: 'color', valueCode: 'black' }],
                },
                {
                    sku: 'sku-new-white',
                    name: '새 흰색 셔츠',
                    supplyPrice: '12000.5',
                    vat: '1200.05',
                    isTaxFree: false,
                    saleStatus: ItemSaleStatus.DENY,
                    selectedOptions: [{ optionCode: 'color', valueCode: 'white' }],
                },
            ],
            categoryIds: [category.id],
            tags: [' 상의 ', '셔츠'],
            reason: '상품 구성 교체',
        });

        const currentItems = product.items.getItems().filter(({ deletedAt }) => deletedAt === null);
        const newItem = currentItems.find(({ sku }) => sku === 'sku-new-white')!;
        expect(result.revision).toBe(7);
        expect(option.id).toBe(71n);
        expect(blackItem).toMatchObject({ name: '검정 셔츠 수정', stock: 12, totalPrice: '11000.000' });
        expect(whiteItem).toMatchObject({ stock: 8, saleStatus: ItemSaleStatus.DENY });
        expect(whiteItem.deletedAt).toBeInstanceOf(Date);
        expect(newItem).toMatchObject({ stock: 0, totalPrice: '13200.550', sequence: 1 });
        expect(product.tags.getItems().map(({ value }) => value)).toEqual(['상의', '셔츠']);

        const snapshot = persistedOf(ProductSnapshotEntity, harness.persisted);
        expect(snapshot).toMatchObject({
            revision: 7,
            changeType: ProductSnapshotChangeType.UPDATE,
            payload: {
                items: [
                    { id: blackItem.id.toString(), totalPrice: '11000.000' },
                    { id: newItem.id.toString(), totalPrice: '13200.550' },
                ],
                tags: [
                    { value: '상의', sequence: 0 },
                    { value: '셔츠', sequence: 1 },
                ],
                categories: [
                    {
                        id: '91',
                        sequence: 0,
                        path: [
                            { id: '90', slug: 'clothing' },
                            { id: '91', slug: 'tops' },
                        ],
                    },
                ],
            },
        });
        snapshot.payload.items.forEach((item) => expect(item).not.toHaveProperty('stock'));
        expect(
            persistedAllOf(ItemOptionValueEntity, harness.persisted).map(({ item, productId, option }) => ({
                itemId: item.id,
                productId,
                productOptionId: option.id,
            }))
        ).toEqual([
            { itemId: blackItem.id, productId: product.id, productOptionId: option.id },
            { itemId: newItem.id, productId: product.id, productOptionId: option.id },
        ]);
        expect(persistedOf(SearchProjectionOutboxEntity, harness.persisted).productRevision).toBe(7);
    });

    it('명시적 Item 생성/수정/삭제도 Product lock과 revision, Snapshot, outbox를 공유한다', async () => {
        const product = createProduct({ revision: 2 });
        const { whiteItem } = attachCatalogGraph(product);
        whiteItem.saleStatus = ItemSaleStatus.DENY;
        whiteItem.deletedAt = new Date('2026-09-03T00:00:00.000Z');
        const harness = createHarness({ product });
        const service = new ProductCommandService(harness.em);

        await service.createItem(seller, {
            productId: product.id,
            expectedRevision: 2,
            item: {
                sku: 'sku-new-white',
                name: '새 흰색 셔츠',
                supplyPrice: '12000',
                vat: '1200',
                isTaxFree: false,
                saleStatus: ItemSaleStatus.DENY,
                selectedOptions: [{ optionCode: 'color', valueCode: 'white' }],
            },
            reason: 'Item 생성',
        });

        const created = product.items.getItems().find(({ sku }) => sku === 'sku-new-white')!;
        expect(created).toMatchObject({ stock: 0, deletedAt: null });
        created.stock = 9;

        await service.updateItem(seller, {
            productId: product.id,
            expectedRevision: 3,
            item: {
                id: created.id,
                sku: created.sku,
                name: '흰색 셔츠 수정',
                supplyPrice: '13000',
                vat: '1300',
                isTaxFree: false,
                saleStatus: ItemSaleStatus.ALLOW,
                selectedOptions: [{ optionCode: 'color', valueCode: 'white' }],
            },
            reason: 'Item 수정',
        });

        expect(created).toMatchObject({ name: '흰색 셔츠 수정', stock: 9, totalPrice: '14300.000' });

        await service.deleteItem(seller, {
            productId: product.id,
            expectedRevision: 4,
            itemId: created.id,
            reason: 'Item 삭제',
        });

        expect(product.revision).toBe(5);
        expect(created).toMatchObject({ stock: 9, saleStatus: ItemSaleStatus.DENY });
        expect(created.deletedAt).toBeInstanceOf(Date);
        expect(harness.findOne).toHaveBeenCalledTimes(3);
        for (const call of harness.findOne.mock.calls) {
            expect(call).toEqual([ProductEntity, { id: product.id }, { lockMode: LockMode.PESSIMISTIC_WRITE }]);
        }

        const snapshots = persistedAllOf(ProductSnapshotEntity, harness.persisted);
        expect(snapshots.map(({ revision, reason }) => ({ revision, reason }))).toEqual([
            { revision: 3, reason: 'Item 생성' },
            { revision: 4, reason: 'Item 수정' },
            { revision: 5, reason: 'Item 삭제' },
        ]);
        expect(snapshots[0].payload.items.find(({ id }) => id === created.id.toString())).toMatchObject({
            name: '새 흰색 셔츠',
            totalPrice: '13200.000',
        });
        expect(snapshots[1].payload.items.find(({ id }) => id === created.id.toString())).toMatchObject({
            name: '흰색 셔츠 수정',
            totalPrice: '14300.000',
        });
        expect(snapshots[2].payload.items).not.toContainEqual(expect.objectContaining({ id: created.id.toString() }));
        expect(
            persistedAllOf(SearchProjectionOutboxEntity, harness.persisted).map(
                ({ productRevision }) => productRevision
            )
        ).toEqual([3, 4, 5]);
    });

    it('기존 서명 형식과 무관하게 같은 옵션 조합의 Item 생성을 거부한다', async () => {
        const product = createProduct();
        attachCatalogGraph(product);
        const harness = createHarness({ product });
        const service = new ProductCommandService(harness.em);

        await expect(
            service.createItem(seller, {
                productId: product.id,
                expectedRevision: 1,
                item: {
                    sku: 'duplicate-black',
                    name: '중복 검정 셔츠',
                    supplyPrice: '10000',
                    vat: '1000',
                    isTaxFree: false,
                    saleStatus: ItemSaleStatus.ALLOW,
                    selectedOptions: [{ optionCode: 'color', valueCode: 'black' }],
                },
            })
        ).rejects.toBeInstanceOf(BadRequestException);

        expect(harness.rolledBack()).toBe(true);
        expect(harness.flush).not.toHaveBeenCalled();
        expect(product.revision).toBe(1);
    });

    it('aggregate Item 가격/필수 옵션 규칙 위반을 transaction 반영 전에 거부한다', async () => {
        const product = createProduct({ revision: 1 });
        const harness = createHarness({ product });
        const service = new ProductCommandService(harness.em);

        await expect(
            service.replaceCatalog(seller, {
                productId: product.id,
                expectedRevision: 1,
                options: [
                    {
                        code: 'color',
                        name: '색상',
                        isRequired: true,
                        values: [{ code: 'black', name: '검정' }],
                    },
                ],
                items: [
                    {
                        name: '잘못된 Item',
                        supplyPrice: '1000',
                        vat: '100',
                        isTaxFree: true,
                        saleStatus: ItemSaleStatus.ALLOW,
                        selectedOptions: [],
                    },
                ],
                categoryIds: [],
                tags: [],
            })
        ).rejects.toBeInstanceOf(BadRequestException);

        expect(harness.rolledBack()).toBe(true);
        expect(harness.flush).not.toHaveBeenCalled();
    });

    it('과거 Snapshot의 Product/Item/옵션 graph를 새 revision으로 복원하고 현재 재고를 보존한다', async () => {
        const product = createProduct({
            revision: 3,
            slug: 'deleted-shirt',
            name: '삭제된 셔츠',
            status: ProductStatus.CLOSED,
            deletedAt: new Date('2026-09-04T00:00:00.000Z'),
        });
        const { blackItem, whiteItem } = attachCatalogGraph(product);
        const captured = createProductSnapshotPayload(product);
        const historicalItem = captured.items.find(({ id }) => id === blackItem.id.toString())!;
        const source = createSnapshot(product, 1, {
            ...captured,
            product: {
                id: product.id.toString(),
                sellerId: seller.memberId.toString(),
                slug: 'original-shirt',
                name: '원본 셔츠',
                description: '원본 설명',
                returnPolicy: null,
                status: ProductStatus.DRAFT,
            },
            items: [
                {
                    ...historicalItem,
                    name: '원본 검정 셔츠',
                    supplyPrice: '5000.000',
                    vat: '500.000',
                    totalPrice: '5500.000',
                },
            ],
        });
        blackItem.name = '변경된 검정 셔츠';
        blackItem.stock = 17;
        const harness = createHarness({ product, source });
        const service = new ProductCommandService(harness.em);

        const result = await service.restore(seller, {
            productId: product.id,
            expectedRevision: 3,
            sourceRevision: 1,
            reason: '삭제 취소',
        });

        expect(result).toEqual({ productId: product.id, revision: 4, status: ProductStatus.DRAFT, deletedAt: null });
        expect(product).toMatchObject({ slug: 'original-shirt', name: '원본 셔츠', description: '원본 설명' });
        expect(blackItem).toMatchObject({
            name: '원본 검정 셔츠',
            supplyPrice: '5000.000',
            totalPrice: '5500.000',
            stock: 17,
            deletedAt: null,
        });
        expect(whiteItem.stock).toBe(8);
        expect(whiteItem.deletedAt).toBeInstanceOf(Date);
        expect(persistedOf(ProductSnapshotEntity, harness.persisted)).toMatchObject({
            revision: 4,
            changeType: ProductSnapshotChangeType.RESTORE,
            payload: {
                product: { slug: 'original-shirt' },
                items: [{ id: blackItem.id.toString(), name: '원본 검정 셔츠' }],
            },
        });
        expect(persistedOf(SearchProjectionOutboxEntity, harness.persisted).productRevision).toBe(4);
    });

    it('Snapshot/outbox flush가 실패하면 명령 transaction 전체를 rollback한다', async () => {
        const product = createProduct({ revision: 2 });
        const databaseError = new Error('snapshot insert failed');
        const harness = createHarness({ product, failOnFlush: 1, flushError: databaseError });
        const service = new ProductCommandService(harness.em);

        await expect(
            service.update(seller, { productId: product.id, expectedRevision: 2, name: '롤백 대상' })
        ).rejects.toBe(databaseError);

        expect(harness.rolledBack()).toBe(true);
        expect(persistedOf(ProductSnapshotEntity, harness.persisted).revision).toBe(3);
        expect(persistedOf(SearchProjectionOutboxEntity, harness.persisted).productRevision).toBe(3);
    });
});

interface HarnessOptions {
    product?: ProductEntity;
    source?: ProductSnapshotEntity;
    assignCreatedProductId?: bigint;
    failOnFlush?: number;
    flushError?: Error;
    categories?: CategoryEntity[];
}

function createHarness(options: HarnessOptions = {}) {
    const persisted: object[] = [];
    const removed: object[] = [];
    let transactionRolledBack = false;
    let nextGeneratedId = 1000n;

    const persist = vi.fn((entity: object | object[]) => {
        persisted.push(...(Array.isArray(entity) ? entity : [entity]));
    });
    const remove = vi.fn((entity: object | object[]) => {
        removed.push(...(Array.isArray(entity) ? entity : [entity]));
    });
    const flush = vi.fn(async () => {
        if (options.assignCreatedProductId) {
            const product = persisted.find((entity) => entity instanceof ProductEntity) as ProductEntity | undefined;
            if (product && product.id === undefined) product.id = options.assignCreatedProductId;
        }
        for (const entity of persisted) {
            if (
                (entity instanceof ItemEntity ||
                    entity instanceof ProductOptionEntity ||
                    entity instanceof ProductOptionValueEntity) &&
                entity.id === undefined
            ) {
                entity.id = nextGeneratedId;
                nextGeneratedId += 1n;
            }
            if (entity instanceof ItemEntity && entity.sku === undefined) entity.sku = `generated-${entity.id}`;
        }
        if (options.failOnFlush === flush.mock.calls.length) throw options.flushError;
    });
    const find = vi.fn(async (entity: unknown) => (entity === CategoryEntity ? (options.categories ?? []) : []));
    const findOne = vi.fn(async (entity: unknown) => {
        if (entity === ProductEntity) return options.product ?? null;
        if (entity === ProductSnapshotEntity) return options.source ?? null;
        return null;
    });
    const populate = vi.fn(async () => undefined);
    const getReference = vi.fn((_: unknown, id: bigint) => Object.assign(new MemberEntity(), { id }));

    const tx = { persist, remove, flush, find, findOne, populate, getReference } as unknown as EntityManager;
    const transactional = vi.fn(async (work: (transaction: EntityManager) => Promise<unknown>) => {
        try {
            return await work(tx);
        } catch (error: unknown) {
            transactionRolledBack = true;
            throw error;
        }
    });
    const em = { transactional } as unknown as EntityManager;

    return {
        em,
        persisted,
        removed,
        persist,
        flush,
        findOne,
        populate,
        transactional,
        rolledBack: () => transactionRolledBack,
    };
}

function createProduct(
    overrides: Partial<{
        revision: number;
        sellerId: bigint;
        slug: string;
        name: string;
        status: ProductStatus;
        deletedAt: Date | null;
    }> = {}
): ProductEntity {
    const product = Object.assign(new ProductEntity(), {
        id: 42n,
        slug: overrides.slug ?? 'basic-shirt',
        name: overrides.name ?? '기본 셔츠',
        description: null,
        returnPolicy: null,
        status: overrides.status ?? ProductStatus.DRAFT,
        revision: overrides.revision ?? 1,
        deletedAt: overrides.deletedAt ?? null,
        seller: Object.assign(new MemberEntity(), { id: overrides.sellerId ?? seller.memberId }),
    });
    return product;
}

function attachCatalogGraph(product: ProductEntity) {
    const option = Object.assign(new ProductOptionEntity(), {
        id: 71n,
        product,
        code: 'color',
        name: '색상',
        isRequired: true,
        sequence: 0,
    });
    const black = Object.assign(new ProductOptionValueEntity(), {
        id: 72n,
        option,
        code: 'black',
        name: '검정',
        sequence: 0,
    });
    const white = Object.assign(new ProductOptionValueEntity(), {
        id: 73n,
        option,
        code: 'white',
        name: '하양',
        sequence: 1,
    });
    option.values = new Collection(option, [black, white]);
    product.options = new Collection(product, [option]);

    const blackItem = createCatalogItem(product, 81n, 'sku-black', 0, 12);
    const whiteItem = createCatalogItem(product, 82n, 'sku-white', 1, 8);
    blackItem.optionValues = new Collection(blackItem, [
        Object.assign(new ItemOptionValueEntity(), { item: blackItem, option, value: black }),
    ]);
    whiteItem.optionValues = new Collection(whiteItem, [
        Object.assign(new ItemOptionValueEntity(), { item: whiteItem, option, value: white }),
    ]);
    product.items = new Collection(product, [blackItem, whiteItem]);

    return { option, blackItem, whiteItem };
}

function createCatalogItem(
    product: ProductEntity,
    id: bigint,
    sku: string,
    sequence: number,
    stock: number
): ItemEntity {
    return Object.assign(new ItemEntity(), {
        id,
        product,
        sku,
        name: `item-${id}`,
        supplyPrice: '9000.000',
        vat: '900.000',
        totalPrice: '9900.000',
        isTaxFree: false,
        saleStatus: ItemSaleStatus.ALLOW,
        stock,
        sequence,
        optionSignature: `${id}`.padStart(64, '0'),
        deletedAt: null,
    });
}

function createSnapshot(
    product: ProductEntity,
    revision: number,
    payload: ProductSnapshotPayload
): ProductSnapshotEntity {
    return Object.assign(new ProductSnapshotEntity(), {
        product,
        revision,
        schemaVersion: 1,
        changeType: ProductSnapshotChangeType.CREATE,
        payload,
    });
}

function persistedOf<T extends object>(entity: new (...args: never[]) => T, persisted: object[]): T {
    const value = persisted.find((candidate) => candidate instanceof entity);
    if (!value) throw new Error(`${entity.name} was not persisted`);
    return value as T;
}

function persistedAllOf<T extends object>(entity: new (...args: never[]) => T, persisted: object[]): T[] {
    return persisted.filter((candidate) => candidate instanceof entity) as T[];
}
