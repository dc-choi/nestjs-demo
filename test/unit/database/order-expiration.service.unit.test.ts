import {
    Collection,
    EntityManager,
    type EntityRepository,
    LockMode,
    RequestContext,
    type TransactionOptions,
} from '@mikro-orm/core';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';

import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { ItemEntity } from '~/api/catalog/domain/entity/item.entity';
import { FulfillmentEntity } from '~/api/fulfillment/domain/fulfillment.entity';
import { InventoryService } from '~/api/inventory/application/inventory.service';
import { InventoryMovementEntity } from '~/api/inventory/domain/inventory-movement.entity';
import { InventoryReservationEntity } from '~/api/inventory/domain/inventory-reservation.entity';
import { InventoryMovementType, InventoryReservationStatus } from '~/api/inventory/domain/inventory.enum';
import { MemberRole } from '~/api/member/domain/member-role';
import { MemberEntity } from '~/api/member/domain/member.entity';
import { OrderExpirationService } from '~/api/order/application/order-expiration.service';
import { OrderItemEntity } from '~/api/order/domain/entity/order-item.entity';
import { OrderEntity } from '~/api/order/domain/entity/order.entity';
import { OrderActorType, OrderStatus } from '~/api/order/domain/entity/order.enum';
import { PaymentAttemptEntity } from '~/api/payment/domain/payment-attempt.entity';
import { PaymentAttemptStatus } from '~/api/payment/domain/payment.enum';
import type { JwtPayload } from '~/global/jwt/payload/jwt.payload';

const NOW = new Date('2026-09-04T00:00:00.000Z');
const EXPIRES_AT = new Date('2026-09-04T00:15:00.000Z');
const BEFORE_EXPIRY = new Date('2026-09-04T00:14:59.999Z');
const ADMIN: JwtPayload = { memberId: 1n, role: MemberRole.ADMIN };

describe('order expiration', () => {
    it('관리자 만료 처리는 주문 전체를 취소하고 모든 예약 재고를 원자적으로 복구한다', async () => {
        const { item, order, reservations, attempt } = createExpiringOrder([2, 1]);
        const [reservation, secondReservation] = reservations;
        const persistence = createExpirationService(reservations, () => null);

        await expect(
            run(persistence, () => persistence.service.expire(ADMIN, reservation.id, 'expire-early', BEFORE_EXPIRY))
        ).rejects.toThrow('아직 만료되지 않은 재고 예약');
        expect(item.stock).toBe(2);
        expect(order.status).toBe(OrderStatus.PENDING);

        const result = await run(persistence, () =>
            persistence.service.expire(ADMIN, reservation.id, 'expire-due', EXPIRES_AT)
        );

        expect(result.reservation).toBe(reservation);
        expect(result.movement).toMatchObject({ idempotencyKey: 'expire-due', stockAfter: 4 });
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
            actorType: OrderActorType.MEMBER,
            actorId: '1',
        });
        expect(
            persistence.persist.mock.calls.filter(([entity]) => entity instanceof InventoryMovementEntity)
        ).toHaveLength(2);
        // Every relation the lock helper walks must be populated under the order row lock.
        expect(persistence.entityManager.findOne).toHaveBeenCalledWith(
            OrderEntity,
            { id: order.id, deletedAt: null },
            expect.objectContaining({
                populate: [
                    'items.item',
                    'items.inventoryReservation',
                    'paymentAttempts',
                    'fulfillments',
                    'statusHistories',
                ],
                lockMode: LockMode.PESSIMISTIC_WRITE,
                refresh: true,
            })
        );
    });

    it('주문 종속 행을 결제 시도, 품목, 예약, 배송 순서로 ID 오름차순 잠근 뒤 예약을 복구한다', async () => {
        const { item, order, reservations, attempt } = createExpiringOrder([2, 1]);
        const [firstItem, secondItem] = order.items.getItems();
        const later = FulfillmentEntity.create(order, 'fulfillment-later', [{ orderItem: firstItem, quantity: 1 }]);
        later.id = 51n;
        const earlier = FulfillmentEntity.create(order, 'fulfillment-earlier', [
            { orderItem: secondItem, quantity: 1 },
        ]);
        earlier.id = 50n;
        const persistence = createExpirationService(reservations, () => null);

        await run(persistence, () => persistence.service.expire(ADMIN, reservations[0].id, 'expire-due', EXPIRES_AT));

        expect(persistence.lockLog.slice(0, 6)).toEqual([attempt, item, ...reservations, earlier, later]);
        expect(persistence.entityManager.refresh).toHaveBeenCalledWith(
            item,
            expect.objectContaining({ lockMode: LockMode.PESSIMISTIC_WRITE })
        );
    });

    it('소비되거나 해제된 예약이 섞인 주문은 만료를 거절하고 아무것도 바꾸지 않는다', async () => {
        const { item, order, reservations, attempt } = createExpiringOrder([2, 1]);
        reservations[1].status = InventoryReservationStatus.CONSUMED;
        const persistence = createExpirationService(reservations, () => null);

        await expect(
            run(persistence, () => persistence.service.expire(ADMIN, reservations[0].id, 'expire-mixed', EXPIRES_AT))
        ).rejects.toThrow('소비되거나 해제된');

        expect(item.stock).toBe(2);
        expect(order.status).toBe(OrderStatus.PENDING);
        expect(attempt.status).toBe(PaymentAttemptStatus.PENDING);
        expect(reservations[0].status).toBe(InventoryReservationStatus.RESERVED);
        expect(persistence.persist).not.toHaveBeenCalled();
    });

    it('다른 요청이 같은 품목에 이미 쓴 멱등성 키는 주문을 바꾸기 전에 거절한다', async () => {
        const { item, order, reservations, attempt } = createExpiringOrder([2]);
        const foreign = InventoryMovementEntity.record({
            item,
            type: InventoryMovementType.RECEIPT,
            quantityDelta: 1,
            stockAfter: 4,
            idempotencyKey: 'shared-key',
        });
        const persistence = createExpirationService(reservations, () => foreign);

        await expect(
            run(persistence, () => persistence.service.expire(ADMIN, reservations[0].id, 'shared-key', EXPIRES_AT))
        ).rejects.toThrow('다른 요청에 사용');

        expect(order.status).toBe(OrderStatus.PENDING);
        expect(attempt.status).toBe(PaymentAttemptStatus.PENDING);
        expect(item.stock).toBe(3);
        expect(persistence.persist).not.toHaveBeenCalled();
    });

    it('같은 멱등성 키를 같은 주문의 다른 예약으로 재요청하면 거절한다', async () => {
        const { reservations } = createExpiringOrder([2, 1]);
        const ledger = new Map<string, InventoryMovementEntity>();
        const persistence = createExpirationService(
            reservations,
            ({ idempotencyKey }) => (idempotencyKey ? (ledger.get(idempotencyKey) ?? null) : null),
            (entity) => {
                if (entity instanceof InventoryMovementEntity) {
                    entity.id = 80n + BigInt(ledger.size);
                    ledger.set(entity.idempotencyKey, entity);
                }
            }
        );

        await run(persistence, () => persistence.service.expire(ADMIN, reservations[0].id, 'expire-multi', EXPIRES_AT));
        await expect(
            run(persistence, () => persistence.service.expire(ADMIN, reservations[1].id, 'expire-multi', EXPIRES_AT))
        ).rejects.toThrow('다른 요청에 사용');
    });

    it('존재하지 않는 예약이나 삭제된 주문은 NotFound로 끝난다', async () => {
        const { reservations } = createExpiringOrder([2]);
        const persistence = createExpirationService(reservations, () => null);

        await expect(
            run(persistence, () => persistence.service.expire(ADMIN, 999n, 'expire-missing', EXPIRES_AT))
        ).rejects.toThrow(NotFoundException);

        vi.mocked(persistence.entityManager.findOne).mockResolvedValueOnce(null);
        await expect(
            run(persistence, () => persistence.service.expire(ADMIN, reservations[0].id, 'expire-deleted', EXPIRES_AT))
        ).rejects.toThrow('주문을 찾을 수 없습니다.');
    });

    it('같은 멱등성 키의 재요청은 주문 이력과 원장을 다시 만들지 않고 첫 결과를 돌려준다', async () => {
        const { item, order, reservations } = createExpiringOrder([2]);
        const [reservation] = reservations;
        let storedMovement: InventoryMovementEntity | null = null;
        const persistence = createExpirationService(
            reservations,
            () => storedMovement,
            (entity) => {
                if (entity instanceof InventoryMovementEntity) {
                    entity.id = 80n;
                    storedMovement = entity;
                }
            }
        );

        const first = await run(persistence, () =>
            persistence.service.expire(ADMIN, reservation.id, 'expire-once', EXPIRES_AT)
        );
        const replay = await run(persistence, () =>
            persistence.service.expire(ADMIN, reservation.id, 'expire-once', EXPIRES_AT)
        );

        expect(replay.movement).toBe(first.movement);
        expect(replay.reservation).toBe(reservation);
        expect(item.stock).toBe(5);
        expect(
            order.statusHistories.getItems().filter(({ toStatus }) => toStatus === OrderStatus.CANCELLED)
        ).toHaveLength(1);
        expect(
            persistence.persist.mock.calls.filter(([entity]) => entity instanceof InventoryMovementEntity)
        ).toHaveLength(1);
    });

    it('다른 요청이 이미 취소한 주문은 새 멱등성 키의 만료 요청을 거절한다', async () => {
        const { item, order, reservations } = createExpiringOrder([2]);
        const [reservation] = reservations;
        const persistence = createExpirationService(reservations, () => null);

        await run(persistence, () => persistence.service.expire(ADMIN, reservation.id, 'expire-first', EXPIRES_AT));
        await expect(
            run(persistence, () => persistence.service.expire(ADMIN, reservation.id, 'expire-second', EXPIRES_AT))
        ).rejects.toThrow(ConflictException);

        expect(order.status).toBe(OrderStatus.CANCELLED);
        expect(item.stock).toBe(5);
        expect(
            persistence.persist.mock.calls.filter(([entity]) => entity instanceof InventoryMovementEntity)
        ).toHaveLength(1);
    });

    it('관리자가 아니면 만료 처리를 거절한다', async () => {
        const { reservations } = createExpiringOrder([2]);
        const persistence = createExpirationService(reservations, () => null);

        await expect(
            persistence.service.expire(
                { memberId: 1n, role: MemberRole.SELLER },
                reservations[0].id,
                'expire',
                EXPIRES_AT
            )
        ).rejects.toThrow(ForbiddenException);
        expect(persistence.entityManager.transactional).not.toHaveBeenCalled();
    });

    it('만료 배치는 주문마다 한 번씩 시스템 actor로 만료하고 주문 ID에서 파생한 키를 쓴다', async () => {
        const { item, order, reservations } = createExpiringOrder([2, 1]);
        const persistence = createExpirationService(reservations, () => null);

        const result = await run(persistence, () => persistence.service.expireDueBatch(10, EXPIRES_AT));

        expect(result).toEqual({ selectedOrders: 1, expiredOrders: 1, failures: [] });
        expect(persistence.entityManager.transactional).toHaveBeenCalledTimes(1);
        expect(persistence.entityManager.fork).toHaveBeenCalledWith({ useContext: false });
        expect(persistence.candidateFind).toHaveBeenCalledWith(
            InventoryReservationEntity,
            {
                status: InventoryReservationStatus.RESERVED,
                expiresAt: { $lte: EXPIRES_AT },
                orderItem: { order: { status: OrderStatus.PENDING, deletedAt: null } },
            },
            {
                populate: ['orderItem.order'],
                orderBy: { expiresAt: 'asc', id: 'asc' },
                limit: 10,
                connectionType: 'write',
            }
        );
        expect(item.stock).toBe(5);
        expect(order.statusHistories.getItems().at(-1)).toMatchObject({
            toStatus: OrderStatus.CANCELLED,
            actorType: OrderActorType.SYSTEM,
            actorId: null,
            requestId: `expire:${createHash('sha256').update(order.id.toString()).digest('hex')}`,
        });
    });

    it('만료 배치는 거절된 주문을 실패로 집계하고 나머지를 계속 처리한다', async () => {
        const { item, order, reservations } = createExpiringOrder([2, 1]);
        const persistence = createExpirationService(reservations, () => null);

        const result = await run(persistence, () => persistence.service.expireDueBatch(10, BEFORE_EXPIRY));

        expect(result).toEqual({
            selectedOrders: 1,
            expiredOrders: 0,
            failures: [
                {
                    orderId: order.id.toString(),
                    reservationId: reservations[0].id.toString(),
                    message: expect.stringContaining('아직 만료되지 않은'),
                },
            ],
        });
        expect(item.stock).toBe(2);
        expect(order.status).toBe(OrderStatus.PENDING);
    });

    it('만료 배치는 사라진 주문을 실패로 집계하지만 예상 밖 오류는 그대로 던진다', async () => {
        const { order, reservations } = createExpiringOrder([2]);
        const persistence = createExpirationService(reservations, () => null);

        vi.mocked(persistence.entityManager.findOne).mockResolvedValueOnce(null);
        await expect(run(persistence, () => persistence.service.expireDueBatch(10, EXPIRES_AT))).resolves.toEqual({
            selectedOrders: 1,
            expiredOrders: 0,
            failures: [
                {
                    orderId: order.id.toString(),
                    reservationId: reservations[0].id.toString(),
                    message: '주문을 찾을 수 없습니다.',
                },
            ],
        });

        vi.spyOn(persistence.inventory, 'restoreForExpiration').mockRejectedValueOnce(new Error('ledger unavailable'));
        await expect(run(persistence, () => persistence.service.expireDueBatch(10, EXPIRES_AT))).rejects.toThrow(
            'ledger unavailable'
        );
    });

    it('만료 배치 크기는 1 이상 500 이하여야 한다', async () => {
        const { reservations } = createExpiringOrder([2]);
        const persistence = createExpirationService(reservations, () => null);

        await expect(persistence.service.expireDueBatch(0, EXPIRES_AT)).rejects.toThrow('배치 크기');
        await expect(persistence.service.expireDueBatch(501, EXPIRES_AT)).rejects.toThrow('배치 크기');
    });
});

function run<T>(persistence: { requestContextSource: EntityManager }, work: () => Promise<T>): Promise<T> {
    return RequestContext.create(persistence.requestContextSource, work);
}

function createExpirationService(
    reservations: readonly InventoryReservationEntity[],
    findMovement: (where: { readonly idempotencyKey?: string }) => InventoryMovementEntity | null,
    onPersist: (entity: object) => void = () => undefined
) {
    const order = reservations[0].orderItem.order;
    const item = reservations[0].orderItem.item;
    const persist = vi.fn(onPersist);
    const lockLog: object[] = [];
    const entityManager = Object.assign(Object.create(EntityManager.prototype), {
        persist,
        isInTransaction: () => true,
    }) as EntityManager;
    entityManager.findOne = vi.fn(async (entity) =>
        entity === OrderEntity ? order : null
    ) as unknown as EntityManager['findOne'];
    entityManager.lock = vi.fn(async (entity: object) => {
        lockLog.push(entity);
    }) as unknown as EntityManager['lock'];
    entityManager.refresh = vi.fn(async (entity: object) => {
        lockLog.push(entity);
        return entity;
    }) as unknown as EntityManager['refresh'];
    const candidateFind = vi.fn(async () => [...reservations]);
    entityManager.fork = vi.fn(() => ({ find: candidateFind })) as unknown as EntityManager['fork'];
    const transactional = vi.fn<
        (work: (entityManager: EntityManager) => Promise<unknown>, options?: TransactionOptions) => Promise<unknown>
    >(async (work) => work(entityManager));
    entityManager.transactional = transactional as unknown as EntityManager['transactional'];
    const requestContextSource = {
        name: 'default',
        fork: vi.fn(() => entityManager),
    } as unknown as EntityManager;
    const reservationRepository = {
        findOne: vi.fn(async ({ id }: { id: bigint }) => reservations.find((candidate) => candidate.id === id) ?? null),
    } as unknown as EntityRepository<InventoryReservationEntity>;
    const inventory = new InventoryService(
        entityManager,
        { findOne: vi.fn(async () => item) } as unknown as EntityRepository<ItemEntity>,
        reservationRepository,
        {
            findOne: vi.fn(async (where: { readonly idempotencyKey?: string }) => findMovement(where)),
        } as unknown as EntityRepository<InventoryMovementEntity>
    );
    const service = new OrderExpirationService(entityManager, reservationRepository, inventory);

    return { service, inventory, persist, lockLog, entityManager, candidateFind, requestContextSource };
}

function createExpiringOrder(quantities: readonly number[]): {
    item: ItemEntity;
    order: OrderEntity;
    reservations: InventoryReservationEntity[];
    attempt: PaymentAttemptEntity;
} {
    const reserved = quantities.reduce((total, quantity) => total + quantity, 0);
    const item = { id: 1n, sku: 'sku-1', stock: 5 - reserved, deletedAt: null } as ItemEntity;
    const order = new OrderEntity();
    order.id = 40n;
    order.member = { id: 2n } as MemberEntity;
    order.status = OrderStatus.PENDING;
    order.deletedAt = null;
    const orderItems = quantities.map((quantity, index) => {
        const orderItem = { item, quantity } as OrderItemEntity;
        orderItem.id = 10n + BigInt(index);
        orderItem.order = order;
        orderItem.fulfillmentItems = new Collection(orderItem);
        return orderItem;
    });
    order.items = new Collection(order, orderItems);
    order.paymentAttempts = new Collection(order);
    order.fulfillments = new Collection(order);
    order.statusHistories = new Collection(order);
    const reservations = orderItems.map((orderItem, index) => {
        const reservation = InventoryReservationEntity.reserve(orderItem, EXPIRES_AT, NOW);
        reservation.id = 20n + BigInt(index);
        return reservation;
    });
    const attempt = PaymentAttemptEntity.create({ order, provider: 'fixture-pay', idempotencyKey: 'pending-attempt' });
    attempt.id = 30n;

    return { item, order, reservations, attempt };
}
