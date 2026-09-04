import type { ItemEntity } from '~/api/catalog/domain/entity/item.entity';
import type { MemberEntity } from '~/api/member/domain/member.entity';
import { OrderItemEntity } from '~/api/order/domain/entity/order-item.entity';
import { OrderEntity } from '~/api/order/domain/entity/order.entity';
import { toOrderType } from '~/api/order/presentation/order.mapper';

describe('order GraphQL mapper', () => {
    it('entity의 bigint와 decimal 값을 GraphQL 안전 문자열로 변환한다', () => {
        const orderItem = OrderItemEntity.create({ quantity: 2, item: createLiveItem() });
        orderItem.id = 40n;

        const order = OrderEntity.place({
            member: { id: 1n } as MemberEntity,
            orderNumber: '019c-test',
            idempotencyKey: 'mapper-fixture-order',
            requestFingerprint: '0'.repeat(64),
            currencyCode: 'KRW',
            items: [orderItem],
        });
        order.id = 30n;
        order.createdAt = new Date('2026-08-13T00:00:00.000Z');

        expect(toOrderType(order)).toEqual({
            id: '30',
            orderNumber: '019c-test',
            status: 'PENDING',
            currencyCode: 'KRW',
            totalPrice: { amount: '2200', currencyCode: 'KRW' },
            createdAt: new Date('2026-08-13T00:00:00.000Z'),
            items: [
                {
                    id: '40',
                    itemId: '20',
                    quantity: 2,
                    lineTotalPrice: { amount: '2200', currencyCode: 'KRW' },
                    snapshot: {
                        productId: '10',
                        productRevision: 7,
                        productName: '기본 티셔츠',
                        itemName: '검정 / L',
                        itemSku: 'sku-v7',
                        productDescription: null,
                        productReturnPolicy: null,
                        unitSupplyPrice: { amount: '1000', currencyCode: 'KRW' },
                        unitVat: { amount: '100', currencyCode: 'KRW' },
                        unitTotalPrice: { amount: '1100', currencyCode: 'KRW' },
                        isTaxFree: false,
                        selectedOptions: [
                            {
                                optionCode: 'color',
                                optionName: '색상',
                                valueCode: 'black',
                                valueName: '검정',
                            },
                        ],
                    },
                },
            ],
        });
    });
});

function createLiveItem(): ItemEntity {
    return {
        id: 20n,
        name: '검정 / L',
        sku: 'sku-v7',
        supplyPrice: '1000',
        vat: '100',
        totalPrice: '1100',
        isTaxFree: false,
        product: {
            id: 10n,
            revision: 7,
            name: '기본 티셔츠',
            description: null,
            returnPolicy: null,
        },
        optionValues: {
            getItems: () => [
                {
                    option: { sequence: 1, code: 'color', name: '색상' },
                    value: { code: 'black', name: '검정' },
                },
            ],
        },
    } as unknown as ItemEntity;
}
