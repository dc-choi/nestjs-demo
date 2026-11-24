import { describe, expect, it } from 'vitest';
import { ProductReadResult } from '~/api/catalog/application/product-read.result.js';
import { toProductType } from '~/api/catalog/presentation/product.mapper.js';

describe('product GraphQL mapper', () => {
    it('canonical read result를 GraphQL 안전 타입으로 변환한다', () => {
        const product: ProductReadResult = {
            id: 1n,
            slug: 'basic-tshirt',
            revision: 2,
            name: '기본 티셔츠',
            description: null,
            returnPolicy: null,
            updatedAt: new Date('2026-08-13T00:00:00.000Z'),
            items: [
                {
                    id: 100n,
                    sku: 'sku-v7',
                    name: '검정 / L',
                    totalPrice: '12000.500',
                    isTaxFree: false,
                    sequence: 0,
                    selectedOptions: [
                        {
                            optionCode: 'color',
                            optionName: '색상',
                            valueCode: 'black',
                            valueName: '검정',
                        },
                    ],
                },
            ],
            options: [],
            categories: [],
            tags: ['티셔츠'],
        };

        expect(toProductType(product)).toMatchObject({
            id: '1',
            revision: 2,
            name: '기본 티셔츠',
            items: [
                {
                    id: '100',
                    price: { amount: '12000.500', currencyCode: 'KRW' },
                    selectedOptions: [{ optionCode: 'color', valueCode: 'black' }],
                },
            ],
        });
    });
});
