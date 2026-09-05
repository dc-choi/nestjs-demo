import {
    Collection,
    EntityManager,
    type EntityRepository,
    RequestContext,
    type TransactionOptions,
} from '@mikro-orm/core';
import { BadRequestException, ConflictException } from '@nestjs/common';

import { describe, expect, it, vi } from 'vitest';
import { ItemEntity } from '~/api/catalog/domain/entity/item.entity';
import { FulfillmentService } from '~/api/fulfillment/application/fulfillment.service';
import { FulfillmentItemEntity } from '~/api/fulfillment/domain/fulfillment-item.entity';
import { FulfillmentEntity } from '~/api/fulfillment/domain/fulfillment.entity';
import { FulfillmentStatus } from '~/api/fulfillment/domain/fulfillment.enum';
import { MemberEntity } from '~/api/member/domain/member.entity';
import { OrderItemEntity } from '~/api/order/domain/entity/order-item.entity';
import { OrderEntity } from '~/api/order/domain/entity/order.entity';
import { OrderStatus } from '~/api/order/domain/entity/order.enum';
import { PaymentAttemptEntity } from '~/api/payment/domain/payment-attempt.entity';

const NOW = new Date('2026-09-04T00:00:00.000Z');
const ADMIN = { memberId: 1n, role: 'ADMIN' as const };

describe('fulfillment lifecycle', () => {
    it('DB에서 역방향 배송 컬렉션을 읽지 않은 주문 품목에도 배송을 배정한다', () => {
        const { order, orderItem } = createConfirmedOrder(1);
        orderItem.fulfillmentItems = new Collection(orderItem, undefined, false);

        expect(() =>
            FulfillmentEntity.create(order, 'uninitialized-inverse-collection', [{ orderItem, quantity: 1 }])
        ).not.toThrow();
    });

    it('분할 배송의 활성 누적 수량이 주문 수량을 넘지 않게 한다', async () => {
        const { order, orderItem } = createConfirmedOrder(2);
        const first = FulfillmentEntity.create(order, 'first-fulfillment', [{ orderItem, quantity: 1 }]);
        first.id = 50n;
        const persistence = createService(order, first);

        await expect(
            RequestContext.create(persistence.requestContextSource, () =>
                persistence.service.create(ADMIN, {
                    orderId: order.id,
                    idempotencyKey: 'over-allocated-fulfillment',
                    items: [{ orderItemId: orderItem.id, quantity: 2 }],
                })
            )
        ).rejects.toThrow('배송 누적 수량은 주문 수량을 초과할 수 없습니다.');

        const second = await RequestContext.create(persistence.requestContextSource, () =>
            persistence.service.create(ADMIN, {
                orderId: order.id,
                idempotencyKey: 'second-fulfillment',
                items: [{ orderItemId: orderItem.id, quantity: 1 }],
            })
        );
        expect(second.items[0]).toMatchObject({ orderItem, quantity: 1 });
        expect(order.fulfillments.getItems()).toHaveLength(2);
        expect(persistence.persist).toHaveBeenCalledWith([second, second.items[0]]);
    });

    it('취소 배송의 수량은 새 배송 배정 한도에서 제외한다', async () => {
        const { order, orderItem } = createConfirmedOrder(2);
        const cancelled = FulfillmentEntity.create(order, 'cancelled-fulfillment', [{ orderItem, quantity: 2 }]);
        cancelled.cancel(NOW);
        const persistence = createService(order, cancelled);

        const replacement = await RequestContext.create(persistence.requestContextSource, () =>
            persistence.service.create(ADMIN, {
                orderId: order.id,
                idempotencyKey: 'replacement-fulfillment',
                items: [{ orderItemId: orderItem.id, quantity: 2 }],
            })
        );

        expect(replacement.items[0].quantity).toBe(2);
    });

    it('저장 범위를 벗어난 배송 수량은 조회 전에 BadRequest로 거부한다', async () => {
        const { order, orderItem } = createConfirmedOrder(1);
        const persistence = createService(
            order,
            FulfillmentEntity.create(order, 'numeric-fixture-fulfillment', [{ orderItem, quantity: 1 }])
        );

        expect(() => FulfillmentItemEntity.allocate(new FulfillmentEntity(), orderItem, 2_147_483_648)).toThrow(
            RangeError
        );

        await expect(
            RequestContext.create(persistence.requestContextSource, () =>
                persistence.service.create(ADMIN, {
                    orderId: order.id,
                    idempotencyKey: 'overflow-fulfillment',
                    items: [{ orderItemId: orderItem.id, quantity: 2_147_483_648 }],
                })
            )
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(persistence.findOrder).not.toHaveBeenCalled();
    });

    it('마지막 수량이 배송 완료되면 주문을 완료하고 상태 이력을 남긴다', async () => {
        const { order, orderItem } = createConfirmedOrder(2);
        const first = FulfillmentEntity.create(order, 'first-delivery', [{ orderItem, quantity: 1 }]);
        first.id = 50n;
        first.pack(NOW);
        first.ship('parcel', 'tracking-1', NOW);
        first.deliver(NOW);
        const second = FulfillmentEntity.create(order, 'second-delivery', [{ orderItem, quantity: 1 }]);
        second.id = 51n;
        second.pack(NOW);
        second.ship('parcel', 'tracking-2', NOW);
        const persistence = createService(order, second);

        await RequestContext.create(persistence.requestContextSource, () =>
            persistence.service.deliver(ADMIN, second.id, NOW)
        );

        expect(second.status).toBe(FulfillmentStatus.DELIVERED);
        expect(order.status).toBe(OrderStatus.COMPLETED);
        expect(order.completedAt).toBe(NOW);
        expect(persistence.persist).toHaveBeenCalledWith(
            expect.objectContaining({
                fromStatus: OrderStatus.CONFIRMED,
                toStatus: OrderStatus.COMPLETED,
                reason: 'ALL_ITEMS_DELIVERED',
            })
        );
    });

    it('포장, 발송, 배송 완료 순서를 강제하고 운송 정보 변경을 막는다', () => {
        const { order, orderItem } = createConfirmedOrder(1);
        const fulfillment = FulfillmentEntity.create(order, 'lifecycle-fulfillment', [{ orderItem, quantity: 1 }]);

        expect(() => fulfillment.deliver(NOW)).toThrow('PENDING 배송은 배송 완료 처리할 수 없습니다.');
        fulfillment.pack(NOW);
        fulfillment.ship('parcel', 'tracking-1', NOW);
        expect(fulfillment.ship('parcel', 'tracking-1', NOW)).toBe(false);
        expect(() => fulfillment.ship('parcel', 'tracking-2', NOW)).toThrow('운송 정보를 변경할 수 없습니다.');
        expect(() => fulfillment.cancel(NOW)).toThrow('SHIPPED 배송은 취소할 수 없습니다.');
    });

    it('같은 배송 생성 멱등성 키는 같은 배정만 재생하고 다른 요청은 거부한다', async () => {
        const { order, orderItem } = createConfirmedOrder(2);
        const existing = FulfillmentEntity.create(order, 'create-fulfillment-1', [{ orderItem, quantity: 1 }]);
        existing.id = 50n;
        const persistence = createService(order, existing);

        const replay = await RequestContext.create(persistence.requestContextSource, () =>
            persistence.service.create(ADMIN, {
                orderId: order.id,
                idempotencyKey: 'create-fulfillment-1',
                items: [{ orderItemId: orderItem.id, quantity: 1 }],
            })
        );
        expect(replay).toBe(existing);
        expect(persistence.persist).not.toHaveBeenCalled();

        await expect(
            RequestContext.create(persistence.requestContextSource, () =>
                persistence.service.create(ADMIN, {
                    orderId: order.id,
                    idempotencyKey: 'create-fulfillment-1',
                    items: [{ orderItemId: orderItem.id, quantity: 2 }],
                })
            )
        ).rejects.toBeInstanceOf(ConflictException);
    });

    it('전액 환불 뒤에는 새 배송 생성과 미발송 배송 진행을 거부한다', async () => {
        const { order, orderItem } = createConfirmedOrder(2);
        const pending = FulfillmentEntity.create(order, 'pending-before-refund', [{ orderItem, quantity: 1 }]);
        pending.id = 50n;
        const shipped = FulfillmentEntity.create(order, 'shipped-before-refund', [{ orderItem, quantity: 1 }]);
        shipped.id = 51n;
        shipped.pack(NOW);
        shipped.ship('parcel', 'tracking-before-refund', NOW);
        order.paymentAttempts[0].refund(true);
        const persistence = createService(order, pending);

        await expect(
            RequestContext.create(persistence.requestContextSource, () =>
                persistence.service.create(ADMIN, {
                    orderId: order.id,
                    idempotencyKey: 'created-after-refund',
                    items: [{ orderItemId: orderItem.id, quantity: 1 }],
                })
            )
        ).rejects.toBeInstanceOf(ConflictException);
        await expect(
            RequestContext.create(persistence.requestContextSource, () =>
                persistence.service.pack(ADMIN, pending.id, NOW)
            )
        ).rejects.toBeInstanceOf(ConflictException);

        const shippedPersistence = createService(order, shipped);
        await expect(
            RequestContext.create(shippedPersistence.requestContextSource, () =>
                shippedPersistence.service.deliver(ADMIN, shipped.id, NOW)
            )
        ).rejects.toBeInstanceOf(ConflictException);
    });

    it('서비스의 잘못된 배송 상태 전이는 Conflict로 번역한다', async () => {
        const { order, orderItem } = createConfirmedOrder(1);
        const pending = FulfillmentEntity.create(order, 'invalid-transition', [{ orderItem, quantity: 1 }]);
        pending.id = 50n;
        const persistence = createService(order, pending);

        await expect(
            RequestContext.create(persistence.requestContextSource, () => persistence.service.deliver(ADMIN, 50n, NOW))
        ).rejects.toBeInstanceOf(ConflictException);
        await expect(
            RequestContext.create(persistence.requestContextSource, () =>
                persistence.service.ship(ADMIN, { fulfillmentId: 50n, carrier: ' ', trackingNumber: 'tracking-1' }, NOW)
            )
        ).rejects.toBeInstanceOf(BadRequestException);
    });
});

function createService(order: OrderEntity, fulfillment: FulfillmentEntity) {
    const persist = vi.fn();
    const populate = vi.fn(async () => undefined);
    const entityManager = Object.assign(Object.create(EntityManager.prototype), { persist, populate }) as EntityManager;
    const transactional = vi.fn<
        (work: (entityManager: EntityManager) => Promise<unknown>, options?: TransactionOptions) => Promise<unknown>
    >(async (work) => work(entityManager));
    entityManager.transactional = transactional as unknown as EntityManager['transactional'];
    const requestContextSource = {
        name: 'default',
        fork: vi.fn(() => entityManager),
    } as unknown as EntityManager;
    const findOrder = vi.fn(async () => order);
    const service = new FulfillmentService(
        entityManager,
        { findOne: findOrder } as unknown as EntityRepository<OrderEntity>,
        { findOne: vi.fn(async () => fulfillment) } as unknown as EntityRepository<FulfillmentEntity>
    );

    return { service, persist, requestContextSource, findOrder };
}

function createConfirmedOrder(quantity: number): { order: OrderEntity; orderItem: OrderItemEntity } {
    const item = {
        id: 10n,
        name: '품목',
        sku: 'sku-10',
        totalPrice: '100',
        supplyPrice: '100',
        vat: '0',
        isTaxFree: true,
        product: { id: 20n, revision: 1, name: '상품', description: null, returnPolicy: null },
        optionValues: { getItems: () => [] },
    } as unknown as ItemEntity;
    const orderItem = OrderItemEntity.create({ quantity, item });
    orderItem.id = 30n;
    const order = OrderEntity.place({
        member: { id: 2n } as MemberEntity,
        orderNumber: 'order-1',
        idempotencyKey: 'fulfillment-fixture-order',
        requestFingerprint: '0'.repeat(64),
        currencyCode: 'KRW',
        items: [orderItem],
        placedAt: NOW,
    });
    order.id = 40n;
    const attempt = PaymentAttemptEntity.create({
        order,
        provider: 'fixture-pay',
        idempotencyKey: 'fixture-payment-attempt',
    });
    attempt.id = 41n;
    attempt.capture(NOW);
    order.transition({ to: OrderStatus.CONFIRMED, actorType: 'PROVIDER', occurredAt: NOW });
    return { order, orderItem };
}
