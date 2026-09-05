import {
    Collection,
    EntityManager,
    type EntityRepository,
    LockMode,
    RequestContext,
    type TransactionOptions,
} from '@mikro-orm/core';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';

import { describe, expect, it, vi } from 'vitest';
import { ItemEntity } from '~/api/catalog/domain/entity/item.entity';
import { ProductEntity } from '~/api/catalog/domain/entity/product.entity';
import { InventoryService } from '~/api/inventory/application/inventory.service';
import { InventoryMovementEntity } from '~/api/inventory/domain/inventory-movement.entity';
import { InventoryReservationEntity } from '~/api/inventory/domain/inventory-reservation.entity';
import { InventoryMovementType, InventoryReservationStatus } from '~/api/inventory/domain/inventory.enum';
import { MemberEntity } from '~/api/member/domain/member.entity';
import { OrderItemEntity } from '~/api/order/domain/entity/order-item.entity';
import { OrderEntity } from '~/api/order/domain/entity/order.entity';
import { OrderStatus } from '~/api/order/domain/entity/order.enum';
import { PaymentAttemptEntity } from '~/api/payment/domain/payment-attempt.entity';
import { PaymentAttemptStatus } from '~/api/payment/domain/payment.enum';

const NOW = new Date('2026-09-04T00:00:00.000Z');
const EXPIRES_AT = new Date('2026-09-04T00:15:00.000Z');

describe('inventory lifecycle', () => {
    it('주문 배치 시 조건부 차감, 예약, 불변 원장을 함께 만든다', async () => {
        const item = createItem(5);
        const orderItem = createOrderItem(item, 2);
        const persist = vi.fn();
        const { service, refresh } = createService(item, { persist });

        const result = await service.reserveForPlacement(
            orderItem,
            EXPIRES_AT,
            'order:one:line:0:reserve',
            'order-one',
            NOW
        );

        expect(refresh).toHaveBeenCalledWith(item, {
            connectionType: 'write',
            lockMode: LockMode.PESSIMISTIC_WRITE,
        });
        expect(item.stock).toBe(3);
        expect(result.reservation).toMatchObject({
            orderItem,
            quantity: 2,
            status: InventoryReservationStatus.RESERVED,
            expiresAt: EXPIRES_AT,
        });
        expect(result.movement).toMatchObject({
            item,
            itemSku: 'sku-1',
            type: InventoryMovementType.RESERVATION,
            quantityDelta: -2,
            stockAfter: 3,
            idempotencyKey: 'order:one:line:0:reserve',
            referenceType: 'ORDER',
            referenceId: 'order-one',
        });
        expect(persist).toHaveBeenCalledWith([result.reservation, result.movement]);
    });

    it('조건부 차감 실패 시 예약과 원장을 만들지 않는다', async () => {
        const item = createItem(1);
        const orderItem = createOrderItem(item, 2);
        const persist = vi.fn();
        const { service } = createService(item, { persist });

        await expect(
            service.reserveForPlacement(orderItem, EXPIRES_AT, 'order:one:line:0:reserve', 'order-one', NOW)
        ).rejects.toBeInstanceOf(BadRequestException);

        expect(item.stock).toBe(1);
        expect(orderItem.inventoryReservation).toBeUndefined();
        expect(persist).not.toHaveBeenCalled();
    });

    it('같은 Item의 중복 주문 라인을 한 번만 lock하고 누적 재고로 예약한다', async () => {
        const item = createItem(5);
        const persist = vi.fn();
        const { service, refresh } = createService(item, { persist });
        const first = createOrderItem(item, 2);
        const second = createOrderItem(item, 3);

        const results = await service.reserveForPlacementBatch(
            [
                { orderItem: first, idempotencyKey: 'reserve-line-1' },
                { orderItem: second, idempotencyKey: 'reserve-line-2' },
            ],
            EXPIRES_AT,
            'order-duplicate-lines',
            NOW
        );

        expect(refresh).toHaveBeenCalledTimes(1);
        expect(item.stock).toBe(0);
        expect(results.map(({ movement }) => movement?.stockAfter)).toEqual([3, 0]);
        expect(persist).toHaveBeenCalledTimes(2);
    });

    it('같은 Item의 중복 라인 합계가 재고를 넘으면 일부 차감 없이 거부한다', async () => {
        const item = createItem(4);
        const persist = vi.fn();
        const { service } = createService(item, { persist });

        await expect(
            service.reserveForPlacementBatch(
                [
                    { orderItem: createOrderItem(item, 2), idempotencyKey: 'reserve-over-line-1' },
                    { orderItem: createOrderItem(item, 3), idempotencyKey: 'reserve-over-line-2' },
                ],
                EXPIRES_AT,
                'order-over-stock',
                NOW
            )
        ).rejects.toBeInstanceOf(BadRequestException);

        expect(item.stock).toBe(4);
        expect(persist).not.toHaveBeenCalled();
    });

    it('예약은 소비하거나 한 번만 복구할 수 있고 만료 전 만료 처리를 거부한다', () => {
        const consumable = InventoryReservationEntity.reserve(createOrderItem(createItem(5), 2), EXPIRES_AT, NOW);
        expect(consumable.consume(new Date('2026-09-04T00:10:00.000Z'))).toBe(true);
        expect(consumable.consume(new Date('2026-09-04T00:11:00.000Z'))).toBe(false);
        expect(() => consumable.release()).toThrow('CONSUMED 재고 예약은 복구할 수 없습니다.');

        const expirable = InventoryReservationEntity.reserve(createOrderItem(createItem(5), 2), EXPIRES_AT, NOW);
        expect(() => expirable.expire(new Date('2026-09-04T00:14:59.999Z'))).toThrow(
            '아직 만료되지 않은 재고 예약입니다.'
        );
        expect(expirable.expire(EXPIRES_AT)).toBe(true);
        expect(expirable.expire(new Date('2026-09-04T00:20:00.000Z'))).toBe(false);
        expect(expirable.releasedAt).toBe(EXPIRES_AT);
    });

    it('예약 해제는 재고와 RELEASE 원장을 정확히 한 번 복구한다', async () => {
        const { item, reservation } = createReservation();
        let storedMovement: InventoryMovementEntity | null = null;
        const persistence = createReservationService(
            reservation,
            () => storedMovement,
            (entity) => {
                if (entity instanceof InventoryMovementEntity) {
                    entity.id = 80n;
                    storedMovement = entity;
                }
            }
        );
        reservation.orderItem.order.status = OrderStatus.CANCELLED;

        const first = await RequestContext.create(persistence.requestContextSource, () =>
            persistence.service.release({ memberId: 1n, role: 'ADMIN' }, reservation.id, 'release-1', NOW)
        );
        const replay = await RequestContext.create(persistence.requestContextSource, () =>
            persistence.service.release({ memberId: 1n, role: 'ADMIN' }, reservation.id, 'release-1', NOW)
        );

        expect(replay.movement).toBe(first.movement);
        expect(item.stock).toBe(5);
        expect(reservation.status).toBe(InventoryReservationStatus.RELEASED);
        expect(first.movement).toMatchObject({
            type: InventoryMovementType.RELEASE,
            quantityDelta: 2,
            stockAfter: 5,
            reason: InventoryReservationStatus.RELEASED,
        });
        expect(persistence.persist).toHaveBeenCalledTimes(1);
    });

    it('관리자 만료 처리는 주문 전체를 취소하고 모든 예약 재고를 원자적으로 복구한다', async () => {
        const { item, reservation } = createReservation();
        const order = reservation.orderItem.order;
        const secondOrderItem = createOrderItem(item, 1);
        secondOrderItem.id = 11n;
        secondOrderItem.order = order;
        order.items = new Collection(order, [...order.items.getItems(), secondOrderItem]);
        const secondReservation = InventoryReservationEntity.reserve(secondOrderItem, EXPIRES_AT, NOW);
        secondReservation.id = 21n;
        item.stock = 2;
        const attempt = PaymentAttemptEntity.create({
            order,
            provider: 'fixture-pay',
            idempotencyKey: 'pending-attempt',
        });
        attempt.id = 30n;
        const persistence = createReservationService([reservation, secondReservation], () => null);

        await expect(
            RequestContext.create(persistence.requestContextSource, () =>
                persistence.service.expire(
                    { memberId: 1n, role: 'ADMIN' },
                    reservation.id,
                    'expire-early',
                    new Date('2026-09-04T00:14:59.999Z')
                )
            )
        ).rejects.toThrow('아직 만료되지 않은 재고 예약');
        expect(item.stock).toBe(2);

        await RequestContext.create(persistence.requestContextSource, () =>
            persistence.service.expire({ memberId: 1n, role: 'ADMIN' }, reservation.id, 'expire-due', EXPIRES_AT)
        );
        expect(item.stock).toBe(5);
        expect(reservation.status).toBe(InventoryReservationStatus.EXPIRED);
        expect(secondReservation.status).toBe(InventoryReservationStatus.EXPIRED);
        expect(attempt.status).toBe(PaymentAttemptStatus.CANCELLED);
        expect(order.status).toBe(OrderStatus.CANCELLED);
        expect(order.statusHistories.getItems().at(-1)).toMatchObject({
            fromStatus: OrderStatus.PENDING,
            toStatus: OrderStatus.CANCELLED,
            reason: 'INVENTORY_RESERVATION_EXPIRED',
            requestId: 'expire-due',
        });
        expect(
            persistence.persist.mock.calls.filter(([entity]) => entity instanceof InventoryMovementEntity)
        ).toHaveLength(2);
    });

    it('만료된 예약 소비 같은 예상 상태 오류를 Conflict로 번역한다', async () => {
        const { reservation } = createReservation();
        const persistence = createReservationService(reservation, () => null);

        await expect(
            RequestContext.create(persistence.requestContextSource, () =>
                persistence.service.consume({ memberId: 2n, role: 'CUSTOMER' }, reservation.id, EXPIRES_AT)
            )
        ).rejects.toBeInstanceOf(ConflictException);
    });

    it('원장 생성 시 0 수량과 불완전한 외부 참조를 거부한다', () => {
        const item = createItem(5);
        const record = (overrides: Partial<Parameters<typeof InventoryMovementEntity.record>[0]> = {}) =>
            InventoryMovementEntity.record({
                item,
                type: InventoryMovementType.ADJUSTMENT,
                quantityDelta: 1,
                stockAfter: 6,
                idempotencyKey: 'adjust-1',
                ...overrides,
            });

        expect(() => record({ quantityDelta: 0 })).toThrow(RangeError);
        expect(() => record({ quantityDelta: 2_147_483_648 })).toThrow(RangeError);
        expect(() => record({ quantityDelta: -2_147_483_649 })).toThrow(RangeError);
        expect(() => record({ stockAfter: 2_147_483_648 })).toThrow(RangeError);
        expect(() => record({ referenceType: 'ORDER' })).toThrow('참조 유형과 ID는 함께 지정해야 합니다.');
    });

    it('판매자 재고 조정을 item 범위 멱등성 키로 한 번만 반영한다', async () => {
        const item = createItem(5);
        let storedMovement: InventoryMovementEntity | null = null;
        const persistence = createTransactionalService(
            item,
            () => storedMovement,
            (entity) => {
                if (entity instanceof InventoryMovementEntity) {
                    entity.id = 70n;
                    storedMovement = entity;
                }
            }
        );
        const command = {
            itemId: item.id,
            type: InventoryMovementType.ADJUSTMENT,
            quantityDelta: -2,
            reason: '재고 실사',
            idempotencyKey: 'adjust-1',
        } as const;

        const first = await RequestContext.create(persistence.requestContextSource, () =>
            persistence.service.adjust({ memberId: 2n, role: 'SELLER' }, command, NOW)
        );

        expect(persistence.findItem).toHaveBeenNthCalledWith(
            1,
            { id: item.id, deletedAt: null },
            { populate: ['product'], connectionType: 'write' }
        );
        expect(persistence.findProduct).toHaveBeenCalledWith(
            ProductEntity,
            { id: item.product.id, deletedAt: null },
            {
                populate: ['seller'],
                connectionType: 'write',
                lockMode: LockMode.PESSIMISTIC_WRITE,
                refresh: true,
            }
        );
        expect(persistence.findItem).toHaveBeenNthCalledWith(
            2,
            { id: item.id, product: item.product.id, deletedAt: null },
            {
                connectionType: 'write',
                lockMode: LockMode.PESSIMISTIC_WRITE,
                refresh: true,
            }
        );
        expect(persistence.findProduct.mock.invocationCallOrder[0]).toBeLessThan(
            persistence.findItem.mock.invocationCallOrder[1]
        );
        const replay = await RequestContext.create(persistence.requestContextSource, () =>
            persistence.service.adjust({ memberId: 2n, role: 'SELLER' }, command, NOW)
        );

        expect(replay).toBe(first);
        expect(item.stock).toBe(3);
        expect(first).toMatchObject({
            type: InventoryMovementType.ADJUSTMENT,
            quantityDelta: -2,
            stockAfter: 3,
            reason: '재고 실사',
        });
        expect(persistence.persist).toHaveBeenCalledTimes(1);

        await expect(
            RequestContext.create(persistence.requestContextSource, () =>
                persistence.service.adjust({ memberId: 2n, role: 'SELLER' }, { ...command, quantityDelta: 1 }, NOW)
            )
        ).rejects.toThrow('다른 요청에 사용');
        expect(item.stock).toBe(3);
    });

    it('재고 조정 결과가 음수가 되거나 입고 수량이 음수이면 거부한다', async () => {
        const item = createItem(1);
        const persistence = createTransactionalService(item, () => null);

        await expect(
            RequestContext.create(persistence.requestContextSource, () =>
                persistence.service.adjust(
                    { memberId: 1n, role: 'ADMIN' },
                    {
                        itemId: item.id,
                        type: InventoryMovementType.ADJUSTMENT,
                        quantityDelta: -2,
                        reason: '재고 실사',
                        idempotencyKey: 'adjust-underflow',
                    },
                    NOW
                )
            )
        ).rejects.toThrow('0 이상 2147483647 이하의 정수');
        await expect(
            RequestContext.create(persistence.requestContextSource, () =>
                persistence.service.adjust(
                    { memberId: 1n, role: 'ADMIN' },
                    {
                        itemId: item.id,
                        type: InventoryMovementType.RECEIPT,
                        quantityDelta: -1,
                        reason: '잘못된 입고',
                        idempotencyKey: 'receipt-negative',
                    },
                    NOW
                )
            )
        ).rejects.toThrow('입고와 반품 수량은 양수');
        expect(item.stock).toBe(1);
        expect(persistence.persist).not.toHaveBeenCalled();
    });

    it('재고 조정과 예약 복구가 signed INT 상한을 넘으면 원본 상태를 유지한다', async () => {
        const adjustmentItem = createItem(2_147_483_647);
        const adjustment = createTransactionalService(adjustmentItem, () => null);

        await expect(
            RequestContext.create(adjustment.requestContextSource, () =>
                adjustment.service.adjust(
                    { memberId: 1n, role: 'ADMIN' },
                    {
                        itemId: adjustmentItem.id,
                        type: InventoryMovementType.RECEIPT,
                        quantityDelta: 1,
                        reason: '상한 검증',
                        idempotencyKey: 'adjust-overflow',
                    },
                    NOW
                )
            )
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(adjustmentItem.stock).toBe(2_147_483_647);

        const { item, reservation } = createReservation();
        item.stock = 2_147_483_647;
        reservation.orderItem.order.status = OrderStatus.CANCELLED;
        const restoration = createReservationService(reservation, () => null);

        await expect(
            RequestContext.create(restoration.requestContextSource, () =>
                restoration.service.release({ memberId: 1n, role: 'ADMIN' }, reservation.id, 'release-overflow', NOW)
            )
        ).rejects.toBeInstanceOf(ConflictException);
        expect(item.stock).toBe(2_147_483_647);
        expect(reservation.status).toBe(InventoryReservationStatus.RESERVED);
        expect(restoration.persist).not.toHaveBeenCalled();
    });

    it('판매자는 자신의 상품 품목만 재고를 조정할 수 있다', async () => {
        const item = createItem(5);
        const persistence = createTransactionalService(item, () => null);

        await expect(
            RequestContext.create(persistence.requestContextSource, () =>
                persistence.service.adjust(
                    { memberId: 999n, role: 'SELLER' },
                    {
                        itemId: item.id,
                        type: InventoryMovementType.ADJUSTMENT,
                        quantityDelta: 1,
                        reason: '타 판매자 재고 조정',
                        idempotencyKey: 'adjust-other-seller',
                    },
                    NOW
                )
            )
        ).rejects.toBeInstanceOf(ForbiddenException);
        expect(item.stock).toBe(5);
        expect(persistence.persist).not.toHaveBeenCalled();
    });

    it('품목이 soft-delete된 후에도 취소된 주문의 예약 재고를 복구한다', async () => {
        const { item, reservation } = createReservation();
        item.deletedAt = new Date('2026-09-04T00:01:00.000Z');
        reservation.orderItem.order.status = OrderStatus.CANCELLED;
        const persistence = createReservationService(reservation, () => null);

        const result = await RequestContext.create(persistence.requestContextSource, () =>
            persistence.service.release({ memberId: 1n, role: 'ADMIN' }, reservation.id, 'release-deleted-item', NOW)
        );

        expect(persistence.findItem).toHaveBeenCalledWith(
            { id: item.id },
            expect.objectContaining({ lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true })
        );
        expect(item.stock).toBe(5);
        expect(result.movement?.stockAfter).toBe(5);
    });
});

function createService(
    item: ItemEntity,
    entityManagerOverrides: { readonly persist: ReturnType<typeof vi.fn> }
): { service: InventoryService; refresh: ReturnType<typeof vi.fn> } {
    const refresh = vi.fn(async (entity: ItemEntity) => entity);
    const entityManager = { ...entityManagerOverrides, refresh } as unknown as EntityManager;
    return {
        service: new InventoryService(
            entityManager,
            { findOne: vi.fn(async () => item) } as unknown as EntityRepository<ItemEntity>,
            {} as EntityRepository<InventoryReservationEntity>,
            {
                findOne: vi.fn<() => Promise<null>>().mockResolvedValue(null),
            } as unknown as EntityRepository<InventoryMovementEntity>
        ),
        refresh,
    };
}

function createItem(stock: number): ItemEntity {
    return {
        id: 1n,
        sku: 'sku-1',
        stock,
        deletedAt: null,
        product: { id: 10n, deletedAt: null, seller: { id: 2n } },
    } as ItemEntity;
}

function createTransactionalService(
    item: ItemEntity,
    findMovement: () => InventoryMovementEntity | null,
    onPersist: (entity: object) => void = () => undefined
) {
    const persist = vi.fn(onPersist);
    const entityManager = Object.assign(Object.create(EntityManager.prototype), { persist }) as EntityManager;
    const findProduct = vi.fn(async () => item.product as ProductEntity);
    entityManager.findOne = findProduct as unknown as EntityManager['findOne'];
    const transactional = vi.fn<
        (work: (entityManager: EntityManager) => Promise<unknown>, options?: TransactionOptions) => Promise<unknown>
    >(async (work) => work(entityManager));
    entityManager.transactional = transactional as unknown as EntityManager['transactional'];
    const requestContextSource = {
        name: 'default',
        fork: vi.fn(() => entityManager),
    } as unknown as EntityManager;
    const findItem = vi.fn(async () => item);
    const service = new InventoryService(
        entityManager,
        { findOne: findItem } as unknown as EntityRepository<ItemEntity>,
        {} as EntityRepository<InventoryReservationEntity>,
        { findOne: vi.fn(async () => findMovement()) } as unknown as EntityRepository<InventoryMovementEntity>
    );

    return { service, persist, requestContextSource, findItem, findProduct };
}

function createReservationService(
    reservationOrReservations: InventoryReservationEntity | readonly InventoryReservationEntity[],
    findMovement: () => InventoryMovementEntity | null,
    onPersist: (entity: object) => void = () => undefined
) {
    const reservations = Array.isArray(reservationOrReservations)
        ? reservationOrReservations
        : [reservationOrReservations];
    const reservation = reservations[0];
    const persist = vi.fn(onPersist);
    const entityManager = Object.assign(Object.create(EntityManager.prototype), { persist }) as EntityManager;
    entityManager.findOne = vi.fn(async (entity) =>
        entity === OrderEntity ? reservation.orderItem.order : null
    ) as unknown as EntityManager['findOne'];
    entityManager.lock = vi.fn(async () => undefined) as unknown as EntityManager['lock'];
    entityManager.refresh = vi.fn(async (entity) => entity) as unknown as EntityManager['refresh'];
    const transactional = vi.fn<
        (work: (entityManager: EntityManager) => Promise<unknown>, options?: TransactionOptions) => Promise<unknown>
    >(async (work) => work(entityManager));
    entityManager.transactional = transactional as unknown as EntityManager['transactional'];
    const requestContextSource = {
        name: 'default',
        fork: vi.fn(() => entityManager),
    } as unknown as EntityManager;
    const findItem = vi.fn(async () => reservation.orderItem.item);
    const service = new InventoryService(
        entityManager,
        { findOne: findItem } as unknown as EntityRepository<ItemEntity>,
        {
            findOne: vi.fn(async ({ id }: { id: bigint }) => reservations.find((candidate) => candidate.id === id)),
        } as unknown as EntityRepository<InventoryReservationEntity>,
        { findOne: vi.fn(async () => findMovement()) } as unknown as EntityRepository<InventoryMovementEntity>
    );

    return { service, persist, requestContextSource, findItem };
}

function createReservation(): { item: ItemEntity; reservation: InventoryReservationEntity } {
    const item = createItem(3);
    const orderItem = createOrderItem(item, 2);
    orderItem.id = 10n;
    const order = new OrderEntity();
    order.id = 40n;
    order.member = { id: 2n } as MemberEntity;
    order.status = OrderStatus.PENDING;
    order.deletedAt = null;
    order.items = new Collection(order, [orderItem]);
    order.paymentAttempts = new Collection(order);
    order.statusHistories = new Collection(order);
    orderItem.order = order;
    const reservation = InventoryReservationEntity.reserve(orderItem, EXPIRES_AT, NOW);
    reservation.id = 20n;
    return { item, reservation };
}

function createOrderItem(item: ItemEntity, quantity: number): OrderItemEntity {
    return { item, quantity } as OrderItemEntity;
}
