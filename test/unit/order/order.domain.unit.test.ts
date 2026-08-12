import { Order } from '~/api/order/domain/order';
import { OrderLine } from '~/api/order/domain/order-line';

describe('order domain', () => {
    it('품목 합계를 정확한 decimal 문자열로 계산한다', () => {
        const first = createOrderLine(1n, 3, '0.1');
        const second = createOrderLine(2n, 2, '1100.250');

        const order = Order.place({
            memberId: 10n,
            orderNumber: '019c-test',
            currencyCode: 'KRW',
            items: [first, second],
        });

        expect(first.lineTotalPrice).toBe('0.3');
        expect(second.lineTotalPrice).toBe('2200.5');
        expect(order.totalPrice).toBe('2200.8');
    });

    it('저장 결과의 ID를 요청 품목 순서대로 결합한다', () => {
        const order = Order.place({
            memberId: 10n,
            orderNumber: '019c-test',
            currencyCode: 'KRW',
            items: [createOrderLine(20n, 1, '1000'), createOrderLine(10n, 1, '2000')],
        });

        const persisted = order.persisted({
            id: 30n,
            status: 'PENDING',
            createdAt: new Date('2026-08-13T00:00:00.000Z'),
            itemIds: [40n, 41n],
        });

        expect(persisted.items.map(({ id, itemId }) => [id, itemId])).toEqual([
            [40n, 20n],
            [41n, 10n],
        ]);
    });
});

function createOrderLine(itemId: bigint, quantity: number, unitTotalPrice: string): OrderLine {
    return OrderLine.create({
        itemId,
        quantity,
        snapshot: {
            productSnapshotId: 100n,
            productName: '상품',
            itemName: '품목',
            itemSku: `sku-${itemId}`,
            productDescription: null,
            productReturnPolicy: null,
            unitSupplyPrice: unitTotalPrice,
            unitVat: '0',
            unitTotalPrice,
            isTaxFree: true,
            selectedOptions: [],
        },
    });
}
