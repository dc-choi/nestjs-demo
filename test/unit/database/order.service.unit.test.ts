import { jest } from '@jest/globals';
import {
    EntityManager,
    type EntityRepository,
    LockMode,
    RequestContext,
    type TransactionOptions,
    UniqueConstraintViolationException,
} from '@mikro-orm/core';
import { BadRequestException, ConflictException } from '@nestjs/common';

import { createHash } from 'node:crypto';
import { ItemSaleStatus } from '~/api/catalog/domain/entity/item-sale-status';
import { ItemEntity } from '~/api/catalog/domain/entity/item.entity';
import { ProductStatus } from '~/api/catalog/domain/entity/product-status';
import { ProductEntity } from '~/api/catalog/domain/entity/product.entity';
import { FulfillmentEntity } from '~/api/fulfillment/domain/fulfillment.entity';
import type { InventoryService } from '~/api/inventory/application/inventory.service';
import { InventoryReservationEntity } from '~/api/inventory/domain/inventory-reservation.entity';
import { MemberEntity } from '~/api/member/domain/member.entity';
import { OrderService } from '~/api/order/application/order.service';
import { OrderItemSnapshotEntity } from '~/api/order/domain/entity/order-item-snapshot.entity';
import { OrderItemEntity } from '~/api/order/domain/entity/order-item.entity';
import { OrderEntity } from '~/api/order/domain/entity/order.entity';
import { OrderStatus } from '~/api/order/domain/entity/order.enum';
import { PaymentAttemptEntity } from '~/api/payment/domain/payment-attempt.entity';
import { PaymentTransactionEntity } from '~/api/payment/domain/payment-transaction.entity';
import { PaymentTransactionType } from '~/api/payment/domain/payment.enum';
import type { DistributedLockService } from '~/global/common/lock/distributed-lock.service';

const ITEM_ID = 9_007_199_254_740_993n;
const PRODUCT_ID = 9_007_199_254_740_995n;
const PRODUCT_REVISION = 7;
const ORDER_ID = 9_007_199_254_741_001n;
const ORDER_ITEM_IDS = [9_007_199_254_741_003n, 9_007_199_254_741_005n] as const;
const CREATED_AT = new Date('2026-08-13T00:00:00.000Z');

describe('OrderService', () => {
    it('분산 락 안의 writer transaction에서 현재 Item을 읽고 저장된 주문을 반환한다', async () => {
        const item = createLiveItem(3);
        const persistence = createPersistenceMocks([ORDER_ITEM_IDS[0]]);
        const findOne = jest.fn<() => Promise<ItemEntity>>().mockResolvedValue(item);
        const { service, getMemberReference, requestContextSource, reserveForPlacement, run, transactional } =
            createService(persistence as unknown as Partial<EntityManager>, findOne);
        run.mockImplementation(async (_keys, work) => {
            expect(transactional).not.toHaveBeenCalled();
            return work();
        });

        const order = await RequestContext.create(requestContextSource, () =>
            service.order(
                { memberId: 10n, role: 'CUSTOMER' },
                { idempotencyKey: 'place-order-1', items: [{ itemId: ITEM_ID, quantity: 2 }] }
            )
        );

        expect(run).toHaveBeenCalledWith(
            expect.arrayContaining([
                expect.stringMatching(/^lock:order:idempotency:[a-f0-9]{64}$/),
                `lock:item:${ITEM_ID}`,
            ]),
            expect.any(Function),
            expect.objectContaining({ ttl: 30_000, maxRetries: 3 })
        );
        expect(findOne).toHaveBeenCalledWith(
            { id: ITEM_ID, deletedAt: null },
            { populate: ['product'], connectionType: 'write' }
        );
        expect(findOne).toHaveBeenCalledWith(
            { id: ITEM_ID, deletedAt: null },
            expect.objectContaining({
                populate: ['product', 'optionValues.option', 'optionValues.value'],
                connectionType: 'write',
                lockMode: LockMode.PESSIMISTIC_WRITE,
                refresh: true,
            })
        );
        expect(reserveForPlacement).toHaveBeenCalledWith(
            expect.objectContaining({ quantity: 2, item }),
            expect.any(Date),
            expect.stringMatching(/^order:.+:line:0:reserve$/),
            expect.any(String),
            expect.any(Date)
        );
        expect(getMemberReference).toHaveBeenCalledWith(10n);

        const transactionOptions = transactional.mock.calls[0][1]!;
        expect(transactionOptions).toEqual({ propagation: 'required' });
        expect(order.id).toBe(ORDER_ID);
        expect(order.createdAt).toBe(CREATED_AT);
        expect(order.totalPrice).toBe('2200.276');
        const [orderItem] = order.items.getItems();
        expect(orderItem.id).toBe(ORDER_ITEM_IDS[0]);
        expect(orderItem.snapshot?.selectedOptions).toEqual([
            { optionCode: 'color', optionName: '색상', valueCode: 'black', valueName: '검정' },
            { optionCode: 'size', optionName: '사이즈', valueCode: 'large', valueName: 'L' },
        ]);
    });

    it('잠근 Item의 합산 재고가 부족하면 주문을 저장하지 않는다', async () => {
        const findOne = jest.fn<() => Promise<ItemEntity>>().mockResolvedValue(createLiveItem(3));
        const reserveForPlacement = jest
            .fn<InventoryService['reserveForPlacement']>()
            .mockRejectedValue(new BadRequestException('재고가 부족합니다.'));
        const persist = jest.fn();
        const { service, requestContextSource, transactional } = createService(
            { persist } as unknown as Partial<EntityManager>,
            findOne,
            reserveForPlacement
        );
        const command = { idempotencyKey: 'place-order-out-of-stock', items: [{ itemId: ITEM_ID, quantity: 2 }] };

        await expect(
            RequestContext.create(requestContextSource, () =>
                service.order({ memberId: 10n, role: 'CUSTOMER' }, command)
            )
        ).rejects.toBeInstanceOf(BadRequestException);
        await expect(
            RequestContext.create(requestContextSource, () =>
                service.order({ memberId: 10n, role: 'CUSTOMER' }, command)
            )
        ).rejects.toBeInstanceOf(BadRequestException);

        expect(persist).not.toHaveBeenCalled();
        expect(transactional).toHaveBeenCalledTimes(2);
    });

    it('같은 Item 주문 행이 여러 개여도 분산 락 resource는 한 번만 요청한다', async () => {
        const item = createLiveItem(3);
        const persistence = createPersistenceMocks([...ORDER_ITEM_IDS]);
        const { service, requestContextSource, run } = createService(
            persistence as unknown as Partial<EntityManager>,
            jest.fn<() => Promise<ItemEntity>>().mockResolvedValue(item)
        );

        await RequestContext.create(requestContextSource, () =>
            service.order(
                { memberId: 10n, role: 'CUSTOMER' },
                {
                    idempotencyKey: 'place-duplicate-item-lines',
                    items: [
                        { itemId: ITEM_ID, quantity: 1 },
                        { itemId: ITEM_ID, quantity: 2 },
                    ],
                }
            )
        );

        const resources = run.mock.calls[0][0];
        expect(resources.filter((resource) => resource === `lock:item:${ITEM_ID}`)).toHaveLength(1);
    });

    it('저장 범위를 벗어난 수량과 주문 총액을 BadRequest로 거부한다', async () => {
        const item = createLiveItem(1_200_000_000);
        item.supplyPrice = '9999999.999';
        item.vat = '0';
        item.totalPrice = '9999999.999';
        const persist = jest.fn();
        const { service, requestContextSource, reserveForPlacement, run } = createService(
            { persist, flush: jest.fn() } as unknown as Partial<EntityManager>,
            jest.fn<() => Promise<ItemEntity>>().mockResolvedValue(item)
        );

        await expect(
            RequestContext.create(requestContextSource, () =>
                service.order(
                    { memberId: 10n, role: 'CUSTOMER' },
                    { idempotencyKey: 'quantity-overflow', items: [{ itemId: ITEM_ID, quantity: 2_147_483_648 }] }
                )
            )
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(run).not.toHaveBeenCalled();

        await expect(
            RequestContext.create(requestContextSource, () =>
                service.order(
                    { memberId: 10n, role: 'CUSTOMER' },
                    {
                        idempotencyKey: 'total-overflow',
                        items: [
                            { itemId: ITEM_ID, quantity: 600_000_000 },
                            { itemId: ITEM_ID, quantity: 600_000_000 },
                        ],
                    }
                )
            )
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(reserveForPlacement).not.toHaveBeenCalled();
        expect(persist).not.toHaveBeenCalled();
    });

    it('중복 Item도 별도 주문 행과 snapshot으로 저장하고 생성 ID 순서를 보존한다', async () => {
        const item = createLiveItem(3);
        const order = OrderEntity.place({
            member: { id: 9_007_199_254_740_997n } as MemberEntity,
            orderNumber: '019c-order-v7',
            idempotencyKey: 'place-domain-1',
            requestFingerprint: '0'.repeat(64),
            currencyCode: 'KRW',
            items: [OrderItemEntity.create({ quantity: 1, item }), OrderItemEntity.create({ quantity: 2, item })],
        });
        const persistence = createPersistenceMocks([...ORDER_ITEM_IDS]);

        persistence.persist(order);
        await persistence.flush();

        expect(order.id).toBe(ORDER_ID);
        expect(order.createdAt).toBe(CREATED_AT);
        expect(order.totalPrice).toBe('3300.414');
        expect(order.items.getItems().map(({ id }) => id)).toEqual(ORDER_ITEM_IDS);
        expect(persistence.entities(OrderEntity)).toHaveLength(1);
        expect(persistence.entities(OrderItemEntity)).toHaveLength(2);
        expect(persistence.entities(OrderItemSnapshotEntity)).toHaveLength(2);

        const orderItems = persistence.entities(OrderItemEntity);
        expect(orderItems.map(({ lineTotalPrice }) => lineTotalPrice)).toEqual(['1100.138', '2200.276']);
        expect(orderItems.map(({ item }) => item.id)).toEqual([ITEM_ID, ITEM_ID]);

        const snapshots = persistence.entities(OrderItemSnapshotEntity);
        expect(snapshots[0].unitTotalPrice).toBe('1100.138');
        expect(snapshots[0].selectedOptions).toEqual([
            { optionCode: 'color', optionName: '색상', valueCode: 'black', valueName: '검정' },
            { optionCode: 'size', optionName: '사이즈', valueCode: 'large', valueName: 'L' },
        ]);
        expect(snapshots[0]).toMatchObject({
            sourceProductId: PRODUCT_ID,
            sourceItemId: ITEM_ID,
            sourceProductRevision: PRODUCT_REVISION,
        });
    });

    it('같은 회원의 같은 멱등성 키와 정규화 요청은 기존 주문을 반환한다', async () => {
        const item = createLiveItem(3);
        const persistence = createPersistenceMocks([ORDER_ITEM_IDS[0]]);
        const { service, requestContextSource, run, orderFindOne, reserveForPlacement } = createService(
            persistence as unknown as Partial<EntityManager>,
            jest.fn<() => Promise<ItemEntity>>().mockResolvedValue(item)
        );
        const firstCommand = {
            idempotencyKey: 'place-replay-1',
            items: [
                { itemId: ITEM_ID, quantity: 2 },
                { itemId: ITEM_ID + 1n, quantity: 1 },
            ],
        };
        const replayCommand = {
            idempotencyKey: 'place-replay-1',
            items: [...firstCommand.items].reverse(),
        };
        const existing = OrderEntity.place({
            member: { id: 10n } as MemberEntity,
            orderNumber: 'order-replay-1',
            idempotencyKey: firstCommand.idempotencyKey,
            requestFingerprint: placeOrderFingerprint(firstCommand.items),
            currencyCode: 'KRW',
            items: [OrderItemEntity.create({ quantity: 2, item })],
            placedAt: CREATED_AT,
        });
        existing.id = ORDER_ID;
        existing.createdAt = CREATED_AT;
        orderFindOne.mockResolvedValue(existing);

        const replay = await RequestContext.create(requestContextSource, () =>
            service.order({ memberId: 10n, role: 'CUSTOMER' }, replayCommand)
        );

        expect(replay).toBe(existing);
        expect(run).not.toHaveBeenCalled();
        expect(reserveForPlacement).not.toHaveBeenCalled();
        expect(orderFindOne).toHaveBeenCalledWith(
            { member: 10n, idempotencyKey: firstCommand.idempotencyKey, deletedAt: null },
            expect.objectContaining({ connectionType: 'write', refresh: true })
        );
    });

    it('같은 멱등성 키의 정규화 요청이 다르면 Conflict를 반환한다', async () => {
        const item = createLiveItem(3);
        const existing = OrderEntity.place({
            member: { id: 10n } as MemberEntity,
            orderNumber: 'order-conflict-1',
            idempotencyKey: 'place-conflict-1',
            requestFingerprint: placeOrderFingerprint([{ itemId: ITEM_ID, quantity: 1 }]),
            currencyCode: 'KRW',
            items: [OrderItemEntity.create({ quantity: 1, item })],
            placedAt: CREATED_AT,
        });
        const { service, requestContextSource, orderFindOne, run } = createService(
            { persist: jest.fn(), flush: jest.fn() } as unknown as Partial<EntityManager>,
            jest.fn<() => Promise<ItemEntity>>()
        );
        orderFindOne.mockResolvedValue(existing);

        await expect(
            RequestContext.create(requestContextSource, () =>
                service.order(
                    { memberId: 10n, role: 'CUSTOMER' },
                    {
                        idempotencyKey: 'place-conflict-1',
                        items: [{ itemId: ITEM_ID, quantity: 2 }],
                    }
                )
            )
        ).rejects.toBeInstanceOf(ConflictException);
        expect(run).not.toHaveBeenCalled();
    });

    it('동시 unique race는 commit된 동일 주문을 재조회해 수렴한다', async () => {
        const item = createLiveItem(3);
        const command = {
            idempotencyKey: 'place-race-1',
            items: [{ itemId: ITEM_ID, quantity: 1 }],
        };
        const existing = OrderEntity.place({
            member: { id: 10n } as MemberEntity,
            orderNumber: 'order-race-winner',
            idempotencyKey: command.idempotencyKey,
            requestFingerprint: placeOrderFingerprint(command.items),
            currencyCode: 'KRW',
            items: [OrderItemEntity.create({ quantity: 1, item })],
            placedAt: CREATED_AT,
        });
        const { service, requestContextSource, orderFindOne, run } = createService(
            { persist: jest.fn(), flush: jest.fn() } as unknown as Partial<EntityManager>,
            jest.fn<() => Promise<ItemEntity>>()
        );
        orderFindOne.mockResolvedValueOnce(null).mockResolvedValueOnce(existing);
        run.mockRejectedValue(new UniqueConstraintViolationException(new Error('Duplicate entry')));

        await expect(
            RequestContext.create(requestContextSource, () =>
                service.order({ memberId: 10n, role: 'CUSTOMER' }, command)
            )
        ).resolves.toBe(existing);
        expect(orderFindOne).toHaveBeenCalledTimes(2);
    });

    it('소유자가 주문을 한 번만 취소하고 RESERVED 재고와 상태 이력을 함께 처리한다', async () => {
        const { order, reservation } = createCancellableOrder();
        const persist = jest.fn();
        const releaseForCancellation = jest.fn(async (target: InventoryReservationEntity) => {
            target.release(CREATED_AT);
            return null;
        });
        const { service, requestContextSource } = createService(
            { persist, flush: jest.fn() } as unknown as Partial<EntityManager>,
            jest.fn<() => Promise<ItemEntity>>(),
            undefined,
            { order, releaseForCancellation }
        );
        const command = { orderId: order.id, idempotencyKey: 'cancel-1', reason: '구매자 요청' };

        const first = await RequestContext.create(requestContextSource, () =>
            service.cancel({ memberId: 10n, role: 'CUSTOMER' }, command, CREATED_AT)
        );
        const replay = await RequestContext.create(requestContextSource, () =>
            service.cancel({ memberId: 10n, role: 'CUSTOMER' }, command, CREATED_AT)
        );

        expect(replay).toBe(first);
        expect(order.status).toBe(OrderStatus.CANCELLED);
        expect(order.cancelledAt).toBe(CREATED_AT);
        expect(reservation.status).toBe('RELEASED');
        expect(releaseForCancellation).toHaveBeenCalledTimes(1);
        expect(persist).toHaveBeenCalledTimes(1);
        expect(order.statusHistories.getItems().at(-1)).toMatchObject({
            fromStatus: OrderStatus.PENDING,
            toStatus: OrderStatus.CANCELLED,
            requestId: 'cancel-1',
            reason: '구매자 요청',
        });
    });

    it('발송된 배송이나 미환불 매입액이 있는 주문 취소를 거부한다', async () => {
        const shipped = createCancellableOrder();
        const fulfillment = FulfillmentEntity.create(shipped.order, 'shipped-fulfillment', [
            { orderItem: shipped.order.items[0], quantity: 1 },
        ]);
        fulfillment.pack(CREATED_AT);
        fulfillment.ship('parcel', 'tracking-1', CREATED_AT);
        const shippedService = createService(
            { persist: jest.fn(), flush: jest.fn() } as unknown as Partial<EntityManager>,
            jest.fn<() => Promise<ItemEntity>>(),
            undefined,
            { order: shipped.order }
        );

        await expect(
            RequestContext.create(shippedService.requestContextSource, () =>
                shippedService.service.cancel(
                    { memberId: 10n, role: 'CUSTOMER' },
                    { orderId: shipped.order.id, idempotencyKey: 'cancel-shipped' },
                    CREATED_AT
                )
            )
        ).rejects.toThrow('발송된 배송');

        const paid = createCancellableOrder();
        const attempt = PaymentAttemptEntity.create({
            order: paid.order,
            provider: 'demo-pay',
            idempotencyKey: 'attempt-1',
        });
        attempt.capture(CREATED_AT);
        PaymentTransactionEntity.succeed({
            paymentAttempt: attempt,
            type: PaymentTransactionType.CAPTURE,
            amount: paid.order.totalPrice,
            idempotencyKey: 'capture-1',
            providerTransactionId: 'tx-1',
            processedAt: CREATED_AT,
        });
        const paidService = createService(
            { persist: jest.fn(), flush: jest.fn() } as unknown as Partial<EntityManager>,
            jest.fn<() => Promise<ItemEntity>>(),
            undefined,
            { order: paid.order }
        );

        await expect(
            RequestContext.create(paidService.requestContextSource, () =>
                paidService.service.cancel(
                    { memberId: 10n, role: 'CUSTOMER' },
                    { orderId: paid.order.id, idempotencyKey: 'cancel-paid' },
                    CREATED_AT
                )
            )
        ).rejects.toThrow('모두 환불');
    });

    it('다른 회원의 주문 취소를 거부한다', async () => {
        const { order } = createCancellableOrder();
        const { service, requestContextSource } = createService(
            { persist: jest.fn(), flush: jest.fn() } as unknown as Partial<EntityManager>,
            jest.fn<() => Promise<ItemEntity>>(),
            undefined,
            { order }
        );

        await expect(
            RequestContext.create(requestContextSource, () =>
                service.cancel(
                    { memberId: 999n, role: 'CUSTOMER' },
                    { orderId: order.id, idempotencyKey: 'cancel-forbidden' },
                    CREATED_AT
                )
            )
        ).rejects.toThrow('다른 회원');
    });
});

function createService(
    transactionOverrides: Partial<EntityManager>,
    findOne: () => Promise<ItemEntity>,
    reserveForPlacement = jest.fn<InventoryService['reserveForPlacement']>().mockResolvedValue({
        reservation: {} as never,
        movement: {} as never,
    }),
    cancellation: {
        readonly order?: OrderEntity;
        readonly releaseForCancellation?: InventoryService['releaseForCancellation'];
    } = {}
) {
    const entityManager = Object.assign(Object.create(EntityManager.prototype), transactionOverrides) as EntityManager;
    entityManager.findOne = jest.fn(async (entityName) => {
        if (entityName !== ProductEntity) return null;
        return (await findOne()).product;
    }) as unknown as EntityManager['findOne'];
    entityManager.lock = jest.fn(async () => undefined) as unknown as EntityManager['lock'];
    entityManager.refresh = jest.fn(async (entity) => entity) as unknown as EntityManager['refresh'];
    const transactional = jest.fn<
        (work: (entityManager: EntityManager) => Promise<unknown>, options?: TransactionOptions) => Promise<unknown>
    >(async (work) => {
        const result = await work(entityManager);
        await entityManager.flush();
        return result;
    });
    entityManager.transactional = transactional as unknown as EntityManager['transactional'];
    const run = jest.fn(async (_keys: string[], work: () => Promise<unknown>) => work());
    const requestContextSource = {
        name: 'default',
        fork: jest.fn(() => entityManager),
    } as unknown as EntityManager;
    const itemRepository = { findOne } as unknown as EntityRepository<ItemEntity>;
    const getMemberReference = jest.fn((id: bigint) => ({ id }) as MemberEntity);
    const memberRepository = { getReference: getMemberReference } as unknown as EntityRepository<MemberEntity>;
    const releaseForCancellation =
        cancellation.releaseForCancellation ??
        jest.fn<InventoryService['releaseForCancellation']>().mockResolvedValue(null);
    const reserveForPlacementBatch = jest.fn<InventoryService['reserveForPlacementBatch']>(
        async (lines, expiresAt, orderNumber, now) =>
            Promise.all(
                lines.map(({ orderItem, idempotencyKey }) =>
                    reserveForPlacement(orderItem, expiresAt, idempotencyKey, orderNumber, now)
                )
            )
    );
    const inventoryService = {
        reserveForPlacement,
        reserveForPlacementBatch,
        releaseForCancellation,
    } as unknown as InventoryService;
    const orderRepository = {
        findOne: jest.fn(async () => cancellation.order ?? null),
    } as unknown as EntityRepository<OrderEntity>;
    const orderFindOne = orderRepository.findOne as jest.MockedFunction<EntityRepository<OrderEntity>['findOne']>;
    const distributedLock = { run } as unknown as DistributedLockService;

    return {
        service: new OrderService(
            entityManager,
            itemRepository,
            memberRepository,
            orderRepository,
            inventoryService,
            distributedLock
        ),
        getMemberReference,
        reserveForPlacement,
        requestContextSource,
        run,
        orderFindOne,
        transactional,
    };
}

function createCancellableOrder(): { order: OrderEntity; reservation: InventoryReservationEntity } {
    const item = createLiveItem(3);
    const orderItem = OrderItemEntity.create({ quantity: 1, item });
    orderItem.id = ORDER_ITEM_IDS[0];
    const order = OrderEntity.place({
        member: { id: 10n } as MemberEntity,
        orderNumber: 'order-cancel-1',
        idempotencyKey: 'place-cancellable-1',
        requestFingerprint: '0'.repeat(64),
        currencyCode: 'KRW',
        items: [orderItem],
        placedAt: CREATED_AT,
    });
    order.id = ORDER_ID;
    order.createdAt = CREATED_AT;
    const reservation = InventoryReservationEntity.reserve(orderItem, new Date('2026-08-13T00:15:00.000Z'), CREATED_AT);
    reservation.id = 9_007_199_254_741_009n;
    return { order, reservation };
}

function placeOrderFingerprint(items: readonly { readonly itemId: bigint; readonly quantity: number }[]): string {
    const normalizedItems = items
        .map(({ itemId, quantity }) => [itemId.toString(), quantity] as const)
        .sort(([leftId, leftQuantity], [rightId, rightQuantity]) => {
            const idOrder = leftId.localeCompare(rightId);
            return idOrder === 0 ? leftQuantity - rightQuantity : idOrder;
        });
    return createHash('sha256')
        .update(JSON.stringify({ items: normalizedItems }))
        .digest('hex');
}

function createLiveItem(stock: number): ItemEntity {
    return {
        id: ITEM_ID,
        sku: 'sku-v7',
        name: '검정 / L',
        supplyPrice: '1000.125',
        vat: '100.013',
        totalPrice: '1100.138',
        isTaxFree: false,
        stock,
        saleStatus: ItemSaleStatus.ALLOW,
        deletedAt: null,
        product: {
            id: PRODUCT_ID,
            revision: PRODUCT_REVISION,
            name: '기본 티셔츠',
            description: null,
            returnPolicy: '미개봉 상품만 반품할 수 있습니다.',
            status: ProductStatus.ACTIVE,
            deletedAt: null,
        },
        optionValues: {
            getItems: () => [
                {
                    option: { sequence: 2, code: 'size', name: '사이즈' },
                    value: { code: 'large', name: 'L' },
                },
                {
                    option: { sequence: 1, code: 'color', name: '색상' },
                    value: { code: 'black', name: '검정' },
                },
            ],
        },
    } as unknown as ItemEntity;
}

function createPersistenceMocks(itemIds: readonly bigint[]) {
    let persistedOrder: OrderEntity | undefined;
    const persist = jest.fn((order: OrderEntity) => {
        persistedOrder = order;
    });
    const flush = jest.fn(async () => {
        if (!persistedOrder) return;

        persistedOrder.id = ORDER_ID;
        persistedOrder.createdAt = CREATED_AT;
        const orderItems = persistedOrder.items.getItems();
        orderItems.forEach((orderItem, index) => {
            orderItem.id = itemIds[index];
        });
    });

    return {
        persist,
        flush,
        entities: <T extends object>(entityType: new () => T): T[] => {
            if (!persistedOrder) return [];

            const items = persistedOrder.items.getItems();
            const snapshots = items.flatMap(({ snapshot }) => (snapshot ? [snapshot] : []));
            const entities: object[] = [persistedOrder, ...items, ...snapshots];
            return entities.filter((entity) => entity instanceof entityType) as T[];
        },
    };
}
