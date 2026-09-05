import { Collection } from '@mikro-orm/core';

import { describe, expect, it } from 'vitest';
import { CatalogGraph, CatalogGraphChange, CatalogGraphError } from '~/api/catalog/domain/catalog-graph';
import { ItemSaleStatus } from '~/api/catalog/domain/entity/item-sale-status';
import { ItemEntity } from '~/api/catalog/domain/entity/item.entity';
import { ProductEntity } from '~/api/catalog/domain/entity/product.entity';

describe('CatalogGraph', () => {
    it('normalizes a valid graph and derives a stable option signature and total price', () => {
        const graph = CatalogGraph.fromInput({
            options: [
                {
                    code: 'color',
                    name: ' 색상 ',
                    isRequired: true,
                    values: [{ code: 'black', name: ' 검정 ' }],
                },
            ],
            items: [
                {
                    sku: ' sku-black ',
                    name: ' 검정 셔츠 ',
                    supplyPrice: '12000.5',
                    vat: '1200.05',
                    isTaxFree: false,
                    saleStatus: ItemSaleStatus.ALLOW,
                    selectedOptions: [{ optionCode: 'color', valueCode: 'black' }],
                },
            ],
            categoryIds: [],
            tags: [' 상의 '],
        });

        expect(graph.options[0]).toMatchObject({ name: '색상', values: [{ name: '검정', sequence: 0 }] });
        expect(graph.items[0]).toMatchObject({
            sku: 'sku-black',
            name: '검정 셔츠',
            supplyPrice: '12000.500',
            vat: '1200.050',
            totalPrice: '13200.550',
            sequence: 0,
        });
        expect(graph.items[0].optionSignature).toMatch(/^[0-9a-f]{64}$/);
        expect(graph.tags).toEqual(['상의']);
    });

    it('rejects invalid option selection and tax totals before persistence', () => {
        const input = {
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
                    name: '면세 셔츠',
                    supplyPrice: '1000',
                    vat: '1',
                    isTaxFree: true,
                    saleStatus: ItemSaleStatus.ALLOW,
                    selectedOptions: [],
                },
            ],
            categoryIds: [],
            tags: [],
        };

        expect(() => CatalogGraph.fromInput(input)).toThrow(CatalogGraphError);
        expect(() => CatalogGraph.fromInput(input)).toThrow('필수 옵션 color의 값이 필요합니다.');
    });

    it('validates snapshot identifiers, stored totals, and signature formats', () => {
        const snapshot = {
            product: {} as never,
            options: [],
            items: [
                {
                    id: 'not-an-id',
                    sku: 'sku',
                    name: 'item',
                    supplyPrice: '1000',
                    vat: '100',
                    totalPrice: '999',
                    isTaxFree: false,
                    saleStatus: ItemSaleStatus.ALLOW,
                    sequence: 0,
                    optionSignature: 'invalid',
                    selectedOptions: [],
                },
            ],
            categories: [],
            media: [],
            tags: [],
        };

        expect(() => CatalogGraph.fromSnapshot(snapshot)).toThrow(CatalogGraphError);
        expect(() => CatalogGraph.fromSnapshot(snapshot)).toThrow('Snapshot ID가 올바르지 않습니다.');
    });

    it('copies category IDs so later caller mutation cannot change validated state', () => {
        const categoryIds = [1n];
        const graph = CatalogGraph.fromInput({ options: [], items: [], categoryIds, tags: [] });

        categoryIds.push(2n);

        expect(graph.categoryIds).toEqual([1n]);
    });

    it('allows an Item command to correct or delete invalid live state before validating the result', () => {
        const product = createProductWithInvalidItem();
        const change = CatalogGraphChange.fromProduct(product);

        expect(change.withoutItem(1n).items).toEqual([]);
        expect(
            change.withUpdatedItem({
                id: 1n,
                sku: 'sku-1',
                name: '정정 Item',
                supplyPrice: '1000',
                vat: '100',
                isTaxFree: false,
                saleStatus: ItemSaleStatus.ALLOW,
                selectedOptions: [],
            }).items[0]
        ).toMatchObject({ totalPrice: '1100.000', name: '정정 Item' });
    });
});

function createProductWithInvalidItem(): ProductEntity {
    const product = new ProductEntity();
    product.id = 42n;
    const item = Object.assign(new ItemEntity(), {
        id: 1n,
        product,
        sku: 'sku-1',
        name: '손상 Item',
        supplyPrice: 'invalid',
        vat: '0.000',
        totalPrice: 'not-a-total',
        isTaxFree: false,
        saleStatus: ItemSaleStatus.ALLOW,
        stock: 0,
        sequence: 0,
        optionSignature: 'not-a-signature',
        deletedAt: null,
    });
    product.items = new Collection(product, [item]);
    return product;
}
