import { OrderRepository, OrderTransaction } from '~/api/order/application/order.repository';
import { OrderService } from '~/api/order/application/order.service';
import { DistributedLockService } from '~/global/common/lock/distributed-lock.service';

describe('OrderService', () => {
    it('분산 락 안에서 application transaction을 조율하고 저장된 주문을 반환한다', async () => {
        const transaction: OrderTransaction = {
            findOrderableItem: jest.fn().mockResolvedValue({
                stock: 3,
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
                    selectedOptions: [],
                },
            }),
            decrementStock: jest.fn().mockResolvedValue(true),
            save: jest.fn().mockImplementation(async (order) =>
                order.persisted({
                    id: 30n,
                    status: 'PENDING',
                    createdAt: new Date('2026-08-13T00:00:00.000Z'),
                    itemIds: [40n],
                })
            ),
        };
        const orderRepository: OrderRepository = {
            transaction: jest.fn((work) => work(transaction)),
        };
        const distributedLock = {
            run: jest.fn((_keys, work) => work()),
        } as unknown as DistributedLockService;
        const service = new OrderService(orderRepository, distributedLock);

        const order = await service.order(
            { memberId: 1n, role: 'CUSTOMER' },
            { items: [{ itemId: 20n, quantity: 2 }] }
        );

        expect(distributedLock.run).toHaveBeenCalledWith(
            ['lock:item:20'],
            expect.any(Function),
            expect.objectContaining({ ttl: 30_000, maxRetries: 3 })
        );
        expect(transaction.decrementStock).toHaveBeenCalledWith(20n, 2);
        expect(order.id).toBe(30n);
        expect(order.totalPrice).toBe('2200');
        expect(order.items[0].id).toBe(40n);
    });
});
