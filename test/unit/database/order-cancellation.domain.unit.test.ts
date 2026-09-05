import { describe, expect, it } from 'vitest';
import { ItemEntity } from '~/api/catalog/domain/entity/item.entity';
import { FulfillmentEntity } from '~/api/fulfillment/domain/fulfillment.entity';
import { InventoryReservationEntity } from '~/api/inventory/domain/inventory-reservation.entity';
import { InventoryReservationStatus } from '~/api/inventory/domain/inventory.enum';
import { MemberEntity } from '~/api/member/domain/member.entity';
import { OrderItemEntity } from '~/api/order/domain/entity/order-item.entity';
import { OrderCancellationConflict, OrderEntity } from '~/api/order/domain/entity/order.entity';
import { OrderActorType, OrderStatus } from '~/api/order/domain/entity/order.enum';
import { PaymentAttemptEntity } from '~/api/payment/domain/payment-attempt.entity';
import { PaymentTransactionEntity } from '~/api/payment/domain/payment-transaction.entity';
import { PaymentAttemptStatus, PaymentTransactionType } from '~/api/payment/domain/payment.enum';

const NOW = new Date('2026-09-05T00:00:00.000Z');
const BEFORE_NOW = new Date('2026-09-04T23:45:00.000Z');
const AFTER_NOW = new Date('2026-09-05T00:15:00.000Z');

describe('order cancellation domain', () => {
    it('회원 취소는 취소 가능한 결제를 종료하고 같은 요청을 변경 없이 재생한다', () => {
        const { order, reservation } = createOrder(AFTER_NOW);
        const attempt = createAttempt(order);

        const first = order.cancelByMember({
            actorId: '10',
            reason: 'CUSTOMER_REQUEST',
            requestId: 'cancel-1',
            occurredAt: NOW,
        });
        const historyCount = order.statusHistories.length;
        const replay = order.cancelByMember({
            actorId: '10',
            reason: 'CUSTOMER_REQUEST',
            requestId: 'cancel-1',
            occurredAt: NOW,
        });

        expect(first).toMatchObject({ isReplay: false, reservations: [reservation] });
        expect(attempt.status).toBe(PaymentAttemptStatus.CANCELLED);
        expect(order.status).toBe(OrderStatus.CANCELLED);
        expect(replay).toEqual({ isReplay: true, history: null, reservations: [] });
        expect(order.statusHistories).toHaveLength(historyCount);
    });

    it('발송된 배송과 미환불 매입 증거는 주문과 예약을 바꾸기 전에 거부한다', () => {
        const shipped = createOrder(AFTER_NOW);
        const fulfillment = FulfillmentEntity.create(shipped.order, 'shipped', [
            { orderItem: shipped.order.items[0], quantity: 1 },
        ]);
        fulfillment.pack(NOW);
        fulfillment.ship('parcel', 'tracking-1', NOW);

        expect(() => cancel(shipped.order)).toThrow(OrderCancellationConflict);
        expect(shipped.order.status).toBe(OrderStatus.PENDING);
        expect(shipped.reservation.status).toBe(InventoryReservationStatus.RESERVED);

        const funded = createOrder(AFTER_NOW);
        const attempt = createAttempt(funded.order);
        PaymentTransactionEntity.succeed({
            paymentAttempt: attempt,
            type: PaymentTransactionType.CAPTURE,
            amount: attempt.requestedAmount,
            idempotencyKey: 'captured-outside-summary',
            providerTransactionId: 'provider-capture-1',
            processedAt: NOW,
        });
        attempt.status = PaymentAttemptStatus.FAILED;

        expect(() => cancel(funded.order)).toThrow('매입된 결제 금액을 모두 환불한 뒤');
        expect(funded.order.status).toBe(OrderStatus.PENDING);
        expect(funded.reservation.status).toBe(InventoryReservationStatus.RESERVED);
        expect(attempt.hasUnrefundedCapture()).toBe(true);
    });

    it('예약 만료는 경계 시각을 포함하고 승인 결제처럼 더 엄격한 조건은 변경 전에 거부한다', () => {
        const expiring = createOrder(NOW);
        const pending = createAttempt(expiring.order);

        const result = expiring.order.expireReservations({
            actorType: OrderActorType.SYSTEM,
            actorId: null,
            requestId: 'expire-at-boundary',
            occurredAt: NOW,
        });

        expect(result).toMatchObject({ isReplay: false, reservations: [expiring.reservation] });
        expect(expiring.order.status).toBe(OrderStatus.CANCELLED);
        expect(pending.status).toBe(PaymentAttemptStatus.CANCELLED);

        const authorized = createOrder(NOW);
        const attempt = createAttempt(authorized.order);
        attempt.status = PaymentAttemptStatus.AUTHORIZED;

        expect(() =>
            authorized.order.expireReservations({
                actorType: OrderActorType.SYSTEM,
                actorId: null,
                requestId: 'expire-authorized',
                occurredAt: NOW,
            })
        ).toThrow('취소할 수 없는 결제 시도');
        expect(authorized.order.status).toBe(OrderStatus.PENDING);
        expect(authorized.reservation.status).toBe(InventoryReservationStatus.RESERVED);
        expect(attempt.status).toBe(PaymentAttemptStatus.AUTHORIZED);
    });

    it('결제 시도는 배송 가능 상태와 만료 가능 상태를 자체적으로 구분한다', () => {
        const { order } = createOrder(AFTER_NOW);
        const attempt = createAttempt(order);

        expect(attempt.isCancellable()).toBe(true);
        expect(attempt.isFunded()).toBe(false);
        attempt.status = PaymentAttemptStatus.CAPTURED;
        expect(attempt.isCancellable()).toBe(false);
        expect(attempt.isFunded()).toBe(true);
        expect(attempt.isTerminalForReservationExpiration()).toBe(false);
        attempt.status = PaymentAttemptStatus.PARTIALLY_REFUNDED;
        expect(attempt.isFunded()).toBe(true);
        attempt.status = PaymentAttemptStatus.REFUNDED;
        expect(attempt.isFunded()).toBe(false);
        attempt.status = PaymentAttemptStatus.FAILED;
        expect(attempt.isTerminalForReservationExpiration()).toBe(true);
    });
});

function cancel(order: OrderEntity) {
    return order.cancelByMember({
        actorId: '10',
        reason: 'CUSTOMER_REQUEST',
        requestId: 'cancel-invalid',
        occurredAt: NOW,
    });
}

function createOrder(expiresAt: Date): { order: OrderEntity; reservation: InventoryReservationEntity } {
    const item = {
        id: 20n,
        name: '품목',
        sku: 'sku-20',
        totalPrice: '100',
        supplyPrice: '100',
        vat: '0',
        isTaxFree: true,
        product: { id: 30n, revision: 1, name: '상품', description: null, returnPolicy: null },
        optionValues: { getItems: () => [] },
    } as unknown as ItemEntity;
    const orderItem = OrderItemEntity.create({ quantity: 1, item });
    orderItem.id = 40n;
    const order = OrderEntity.place({
        member: { id: 10n } as MemberEntity,
        orderNumber: 'order-cancellation-domain',
        idempotencyKey: 'order-cancellation-domain',
        requestFingerprint: '0'.repeat(64),
        currencyCode: 'KRW',
        items: [orderItem],
        placedAt: BEFORE_NOW,
    });
    order.id = 50n;
    const reservation = InventoryReservationEntity.reserve(orderItem, expiresAt, BEFORE_NOW);
    reservation.id = 60n;
    return { order, reservation };
}

function createAttempt(order: OrderEntity): PaymentAttemptEntity {
    const attempt = PaymentAttemptEntity.create({
        order,
        provider: 'demo-pay',
        idempotencyKey: `attempt-${order.paymentAttempts.length}`,
    });
    attempt.id = BigInt(order.paymentAttempts.length);
    return attempt;
}
