import { Collection } from '@mikro-orm/core';

import { CategoryEntity } from '~/api/catalog/domain/entity/category.entity';
import { ItemOptionValueEntity } from '~/api/catalog/domain/entity/item-option-value.entity';
import { ItemSaleStatus } from '~/api/catalog/domain/entity/item-sale-status';
import { ItemEntity } from '~/api/catalog/domain/entity/item.entity';
import { MediaAssetEntity } from '~/api/catalog/domain/entity/media-asset.entity';
import { ProductCategoryEntity } from '~/api/catalog/domain/entity/product-category.entity';
import { ProductMediaRole } from '~/api/catalog/domain/entity/product-media-role';
import { ProductMediaEntity } from '~/api/catalog/domain/entity/product-media.entity';
import { ProductOptionValueEntity } from '~/api/catalog/domain/entity/product-option-value.entity';
import { ProductOptionEntity } from '~/api/catalog/domain/entity/product-option.entity';
import { ProductStatus } from '~/api/catalog/domain/entity/product-status';
import { ProductTagEntity } from '~/api/catalog/domain/entity/product-tag.entity';
import { ProductEntity } from '~/api/catalog/domain/entity/product.entity';
import { createProductSnapshotPayload } from '~/api/catalog/domain/product-snapshot.factory';
import { MemberEntity } from '~/api/member/domain/member.entity';

describe('createProductSnapshotPayload', () => {
    it('live graph을 ID 문자열과 안정적인 순서로 정규화하고 재고를 제외한다', () => {
        const product = createProductGraph();

        const first = createProductSnapshotPayload(product);
        const second = createProductSnapshotPayload(product);

        expect(second).toEqual(first);
        expect(first.product).toEqual({
            id: '9007199254740993',
            sellerId: '9007199254740994',
            slug: 'basic-shirt',
            name: '기본 셔츠',
            description: '상품 설명',
            returnPolicy: null,
            status: ProductStatus.ACTIVE,
        });
        expect(first.items.map(({ id }) => id)).toEqual(['12', '11']);
        expect(first.items[0].selectedOptions.map(({ optionCode }) => optionCode)).toEqual(['size', 'color']);
        expect(first.items[0]).not.toHaveProperty('stock');
        expect(first.options.map(({ id }) => id)).toEqual(['22', '21']);
        expect(first.options[1].values.map(({ id }) => id)).toEqual(['32', '31']);
        expect(first.categories.map(({ id }) => id)).toEqual(['42', '41']);
        expect(first.categories[0].path).toEqual([
            { id: '40', name: '의류', slug: 'clothing' },
            { id: '42', name: '상의', slug: 'tops' },
        ]);
        expect(first.media.map(({ id }) => id)).toEqual(['52', '51']);
        expect(first.tags).toEqual([
            { value: '셔츠', sequence: 0 },
            { value: '상의', sequence: 1 },
        ]);
    });
});

function createProductGraph(): ProductEntity {
    const product = Object.assign(new ProductEntity(), {
        id: 9_007_199_254_740_993n,
        seller: Object.assign(new MemberEntity(), { id: 9_007_199_254_740_994n }),
        slug: 'basic-shirt',
        name: '기본 셔츠',
        description: '상품 설명',
        returnPolicy: null,
        status: ProductStatus.ACTIVE,
    });

    const color = createOption(product, 21n, 'color', '색상', 1, [
        createOptionValue(31n, 'white', '흰색', 1),
        createOptionValue(32n, 'black', '검정', 0),
    ]);
    const size = createOption(product, 22n, 'size', '크기', 0, [createOptionValue(33n, 'large', 'L', 0)]);
    product.options = new Collection(product, [color, size]);

    const laterItem = createItem(product, 11n, 1);
    const firstItem = createItem(product, 12n, 0);
    firstItem.optionValues = new Collection(firstItem, [
        createSelection(firstItem, color, color.values.getItems()[0]),
        createSelection(firstItem, size, size.values.getItems()[0]),
    ]);
    const deletedItem = createItem(product, 10n, 2);
    deletedItem.deletedAt = new Date('2026-09-04T00:00:00.000Z');
    product.items = new Collection(product, [laterItem, deletedItem, firstItem]);

    const root = createCategory(40n, '의류', 'clothing', null);
    const tops = createCategory(42n, '상의', 'tops', root);
    const basics = createCategory(41n, '기본', 'basics', root);
    product.categories = new Collection(product, [
        Object.assign(new ProductCategoryEntity(), { product, category: basics, sequence: 1 }),
        Object.assign(new ProductCategoryEntity(), { product, category: tops, sequence: 0 }),
    ]);

    product.media = new Collection(product, [
        createMedia(product, 51n, ProductMediaRole.THUMBNAIL, 0, 61n),
        createMedia(product, 52n, ProductMediaRole.GALLERY, 0, 62n),
    ]);
    product.tags = new Collection(product, [
        Object.assign(new ProductTagEntity(), { product, value: '상의', sequence: 1 }),
        Object.assign(new ProductTagEntity(), { product, value: '셔츠', sequence: 0 }),
    ]);

    return product;
}

function createOption(
    product: ProductEntity,
    id: bigint,
    code: string,
    name: string,
    sequence: number,
    values: ProductOptionValueEntity[]
): ProductOptionEntity {
    const option = Object.assign(new ProductOptionEntity(), { product, id, code, name, sequence, isRequired: true });
    values.forEach((value) => (value.option = option));
    option.values = new Collection(option, values);
    return option;
}

function createOptionValue(id: bigint, code: string, name: string, sequence: number): ProductOptionValueEntity {
    return Object.assign(new ProductOptionValueEntity(), { id, code, name, sequence });
}

function createItem(product: ProductEntity, id: bigint, sequence: number): ItemEntity {
    return Object.assign(new ItemEntity(), {
        product,
        id,
        sku: `sku-${id}`,
        name: `item-${id}`,
        supplyPrice: '1000.000',
        vat: '100.000',
        totalPrice: '1100.000',
        isTaxFree: false,
        saleStatus: ItemSaleStatus.ALLOW,
        stock: 99,
        sequence,
        optionSignature: `${id}`.padStart(64, '0'),
        deletedAt: null,
    });
}

function createSelection(
    item: ItemEntity,
    option: ProductOptionEntity,
    value: ProductOptionValueEntity
): ItemOptionValueEntity {
    return Object.assign(new ItemOptionValueEntity(), { item, option, value });
}

function createCategory(id: bigint, name: string, slug: string, parent: CategoryEntity | null): CategoryEntity {
    return Object.assign(new CategoryEntity(), { id, name, slug, parent });
}

function createMedia(
    product: ProductEntity,
    id: bigint,
    role: ProductMediaRole,
    sequence: number,
    assetId: bigint
): ProductMediaEntity {
    const asset = Object.assign(new MediaAssetEntity(), {
        id: assetId,
        storageKey: `products/${assetId}`,
        originalName: null,
        mimeType: 'image/webp',
        byteSize: 1024n,
        checksum: `${assetId}`.padStart(64, '0'),
        width: 100,
        height: 100,
    });
    return Object.assign(new ProductMediaEntity(), { product, id, role, sequence, altText: null, asset });
}
