import { Order } from '~/api/order/domain/order';
import { OrderLine } from '~/api/order/domain/order-line';
import { toOrderType } from '~/api/order/presentation/order.mapper';

describe('order GraphQL mapper', () => {
    it('domain의 bigint와 decimal 값을 GraphQL 안전 문자열로 변환한다', () => {
        const orderLine = OrderLine.create({
            itemId: 20n,
            quantity: 2,
            snapshot: {
                productSnapshotId: 10n,
                productName: '기본 티셔츠',
                itemName: '검정 / L',
                itemSku: 'sku-v7',
                productDescription: null,
                productReturnPolicy: null,
                unitSupplyPrice: '1000',
                unitVat: '100',
                unitTotalPrice: '1100',
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
        });
        const order = Order.place({
            memberId: 1n,
            orderNumber: '019c-test',
            currencyCode: 'KRW',
            items: [orderLine],
        }).persisted({
            id: 30n,
            status: 'PENDING',
            createdAt: new Date('2026-08-13T00:00:00.000Z'),
            itemIds: [40n],
        });

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
                        productSnapshotId: '10',
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
