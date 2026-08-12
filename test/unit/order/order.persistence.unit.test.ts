import { Order } from '~/api/order/domain/order';
import { OrderLine } from '~/api/order/domain/order-line';
import { toPersistedOrder } from '~/api/order/infrastructure/order.persistence';

describe('order persistence mapper', () => {
    it('DB 반환 순서와 무관하게 원천 Item에 생성된 OrderItem ID를 연결한다', () => {
        const order = Order.place({
            memberId: 10n,
            orderNumber: '019c-test',
            currencyCode: 'KRW',
            items: [createOrderLine(20n), createOrderLine(10n)],
        });

        const persisted = toPersistedOrder(order, {
            id: 30n,
            status: 'PENDING',
            createdAt: new Date('2026-08-13T00:00:00.000Z'),
            OrderItem: [
                { id: 40n, itemId: 10n },
                { id: 41n, itemId: 20n },
            ],
        });

        expect(persisted.items.map(({ id, itemId }) => [id, itemId])).toEqual([
            [41n, 20n],
            [40n, 10n],
        ]);
    });
});

function createOrderLine(itemId: bigint): OrderLine {
    return OrderLine.create({
        itemId,
        quantity: 1,
        snapshot: {
            productSnapshotId: 100n,
            productName: '상품',
            itemName: '품목',
            itemSku: `sku-${itemId}`,
            productDescription: null,
            productReturnPolicy: null,
            unitSupplyPrice: '1000',
            unitVat: '0',
            unitTotalPrice: '1000',
            isTaxFree: true,
            selectedOptions: [],
        },
    });
}
