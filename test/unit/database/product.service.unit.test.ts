import { Collection, type EntityRepository, LoadStrategy, PopulateHint } from '@mikro-orm/core';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductService } from '~/api/catalog/application/product.service';
import { CategoryEntity } from '~/api/catalog/domain/entity/category.entity';
import { ItemOptionValueEntity } from '~/api/catalog/domain/entity/item-option-value.entity';
import { ItemSaleStatus } from '~/api/catalog/domain/entity/item-sale-status';
import { ItemEntity } from '~/api/catalog/domain/entity/item.entity';
import { ProductCategoryEntity } from '~/api/catalog/domain/entity/product-category.entity';
import { ProductOptionValueEntity } from '~/api/catalog/domain/entity/product-option-value.entity';
import { ProductOptionEntity } from '~/api/catalog/domain/entity/product-option.entity';
import { ProductStatus } from '~/api/catalog/domain/entity/product-status';
import { ProductTagEntity } from '~/api/catalog/domain/entity/product-tag.entity';
import { ProductEntity } from '~/api/catalog/domain/entity/product.entity';

describe('ProductService', () => {
    const findOne = vi.fn<EntityRepository<ProductEntity>['findOne']>();
    const repository = { findOne } as unknown as EntityRepository<ProductEntity>;
    const service = new ProductService(repository);

    beforeEach(() => {
        findOne.mockReset();
    });

    it('현재 판매 상품을 단일 writer JOINED 조회하고 read result 순서를 안정적으로 맞춘다', async () => {
        findOne.mockResolvedValue(createProduct() as never);

        const product = await service.findCurrentById(9007199254740993n);

        expect(findOne).toHaveBeenCalledTimes(1);
        expect(findOne).toHaveBeenCalledWith(
            {
                id: 9007199254740993n,
                status: ProductStatus.ACTIVE,
                deletedAt: null,
                items: {
                    saleStatus: ItemSaleStatus.ALLOW,
                    deletedAt: null,
                },
            },
            expect.objectContaining({
                populateWhere: PopulateHint.INFER,
                strategy: LoadStrategy.JOINED,
                connectionType: 'write',
                disableIdentityMap: true,
            })
        );
        expect(findOne.mock.calls[0][1]?.populate).not.toContain('snapshots');
        expect(product).toMatchObject({
            id: 9007199254740993n,
            slug: 'basic-tshirt',
            revision: 2,
            name: '기본 티셔츠',
            items: [
                {
                    id: 9007199254740995n,
                    price: { amount: '12000.5', currencyCode: 'KRW' },
                    selectedOptions: [
                        { optionCode: 'color', valueCode: 'black' },
                        { optionCode: 'size', valueCode: 'large' },
                    ],
                },
                { id: 9007199254740996n },
            ],
            options: [
                {
                    id: 9007199254740997n,
                    values: [
                        { id: 9007199254740998n, code: 'black' },
                        { id: 9007199254740999n, code: 'white' },
                    ],
                },
                { id: 9007199254741000n },
            ],
            categories: [
                { id: 9007199254741001n, name: '상의', slug: 'tops' },
                { id: 9007199254741002n, name: '의류', slug: 'clothing' },
            ],
            tags: ['티셔츠', '상의'],
        });
    });

    it('현재 판매 조건을 만족하는 상품이 없으면 null을 반환한다', async () => {
        findOne.mockResolvedValue(null);

        await expect(service.findCurrentById(1n)).resolves.toBeNull();
    });

    it('DENY 또는 삭제된 Item을 JOIN 단계에서 제외한다', async () => {
        findOne.mockResolvedValue(null);

        await service.findCurrentById(1n);

        expect(findOne.mock.calls[0][0]).toMatchObject({
            items: {
                saleStatus: ItemSaleStatus.ALLOW,
                deletedAt: null,
            },
        });
        expect(findOne.mock.calls[0][1]).toMatchObject({
            populateWhere: PopulateHint.INFER,
            strategy: LoadStrategy.JOINED,
        });
    });
});

function createProduct(): ProductEntity {
    const product = Object.assign(new ProductEntity(), {
        id: 9007199254740993n,
        slug: 'basic-tshirt',
        revision: 2,
        name: '기본 티셔츠',
        description: '상품 설명',
        returnPolicy: null,
        updatedAt: new Date('2026-08-13T00:00:00.000Z'),
    });

    const size = createOption(9007199254741000n, 'size', '크기', 1, [
        createOptionValue(9007199254741003n, 'large', 'L', 0),
    ]);
    const color = createOption(9007199254740997n, 'color', '색상', 0, [
        createOptionValue(9007199254740999n, 'white', '흰색', 1),
        createOptionValue(9007199254740998n, 'black', '검정', 0),
    ]);
    const firstItem = createItem(9007199254740995n, 0, '12000.500');
    firstItem.optionValues = new Collection(firstItem, [
        createSelection(firstItem, size, size.values.getItems()[0]),
        createSelection(firstItem, color, color.values.getItems()[1]),
    ]);
    const secondItem = createItem(9007199254740996n, 1, '9999.000');

    product.items = new Collection(product, [secondItem, firstItem]);
    product.options = new Collection(product, [size, color]);
    product.categories = new Collection(product, [
        createCategory(product, 9007199254741002n, '의류', 'clothing', 1),
        createCategory(product, 9007199254741001n, '상의', 'tops', 0),
    ]);
    product.tags = new Collection(product, [createTag(product, '상의', 1), createTag(product, '티셔츠', 0)]);

    return product;
}

function createItem(id: bigint, sequence: number, totalPrice: string): ItemEntity {
    return Object.assign(new ItemEntity(), {
        id,
        sku: `sku-${id}`,
        name: `item-${id}`,
        totalPrice,
        isTaxFree: false,
        sequence,
    });
}

function createOption(
    id: bigint,
    code: string,
    name: string,
    sequence: number,
    values: ProductOptionValueEntity[]
): ProductOptionEntity {
    const option = Object.assign(new ProductOptionEntity(), { id, code, name, sequence, isRequired: true });
    option.values = new Collection(option, values);
    return option;
}

function createOptionValue(id: bigint, code: string, name: string, sequence: number): ProductOptionValueEntity {
    return Object.assign(new ProductOptionValueEntity(), { id, code, name, sequence });
}

function createSelection(
    item: ItemEntity,
    option: ProductOptionEntity,
    value: ProductOptionValueEntity
): ItemOptionValueEntity {
    return Object.assign(new ItemOptionValueEntity(), { item, option, value });
}

function createCategory(
    product: ProductEntity,
    id: bigint,
    name: string,
    slug: string,
    sequence: number
): ProductCategoryEntity {
    const category = Object.assign(new CategoryEntity(), { id, name, slug });
    return Object.assign(new ProductCategoryEntity(), { product, category, sequence });
}

function createTag(product: ProductEntity, value: string, sequence: number): ProductTagEntity {
    return Object.assign(new ProductTagEntity(), { product, value, sequence });
}
