import { jest } from '@jest/globals';
import { EntityManager, type EntityRepository, RequestContext, type TransactionOptions } from '@mikro-orm/core';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { createHmac } from 'node:crypto';
import { ItemEntity } from '~/api/catalog/domain/entity/item.entity';
import { FulfillmentEntity } from '~/api/fulfillment/domain/fulfillment.entity';
import type { InventoryService } from '~/api/inventory/application/inventory.service';
import { InventoryReservationEntity } from '~/api/inventory/domain/inventory-reservation.entity';
import { MemberEntity } from '~/api/member/domain/member.entity';
import { OrderItemEntity } from '~/api/order/domain/entity/order-item.entity';
import { OrderEntity } from '~/api/order/domain/entity/order.entity';
import { OrderStatus } from '~/api/order/domain/entity/order.enum';
import { PaymentWebhookOutcome } from '~/api/payment/application/payment.command';
import { PaymentService } from '~/api/payment/application/payment.service';
import { PaymentAttemptEntity } from '~/api/payment/domain/payment-attempt.entity';
import { PaymentTransactionEntity } from '~/api/payment/domain/payment-transaction.entity';
import { PaymentWebhookEventEntity } from '~/api/payment/domain/payment-webhook-event.entity';
import {
    PaymentAttemptStatus,
    PaymentTransactionType,
    PaymentWebhookEventStatus,
} from '~/api/payment/domain/payment.enum';
import { HmacPaymentWebhookSignatureVerifier } from '~/api/payment/infrastructure/payment-webhook-signature.verifier';
import type { EnvConfig } from '~/global/config/env/env.config';

const NOW = new Date('2026-09-04T00:00:00.000Z');
const ADMIN = { memberId: 1n, role: 'ADMIN' as const };

describe('payment lifecycle', () => {
    it('매입을 한 번만 기록하고 재고 예약 소비와 주문 확정 이력을 같은 작업에서 만든다', async () => {
        const { attempt, reservation } = createAttempt();
        const persistence = createPaymentService(attempt);

        const first = await RequestContext.create(persistence.requestContextSource, () =>
            persistence.service.capture(
                ADMIN,
                { paymentAttemptId: attempt.id, idempotencyKey: 'capture-1', providerTransactionId: 'tx-capture-1' },
                NOW
            )
        );
        first.transaction!.id = 50n;
        persistence.findTransaction.mockResolvedValue(first.transaction);

        const replay = await RequestContext.create(persistence.requestContextSource, () =>
            persistence.service.capture(
                ADMIN,
                { paymentAttemptId: attempt.id, idempotencyKey: 'capture-1', providerTransactionId: 'tx-capture-1' },
                NOW
            )
        );

        expect(replay.transaction).toBe(first.transaction);
        expect(attempt.status).toBe(PaymentAttemptStatus.CAPTURED);
        expect(reservation.status).toBe('CONSUMED');
        expect(attempt.order.status).toBe(OrderStatus.CONFIRMED);
        expect(attempt.transactions.getItems()).toHaveLength(1);
        expect(persistence.consumeForPayment).toHaveBeenCalledTimes(1);
        expect(persistence.persist).toHaveBeenCalledWith(
            expect.objectContaining({ type: PaymentTransactionType.CAPTURE, amount: '100' })
        );
        expect(persistence.persist).toHaveBeenCalledWith(
            expect.objectContaining({ fromStatus: OrderStatus.PENDING, toStatus: OrderStatus.CONFIRMED })
        );
    });

    it('누적 환불이 매입액을 넘지 않게 하고 부분 및 전액 환불 상태를 구분한다', async () => {
        const { attempt } = createAttempt();
        attempt.capture(NOW);
        attempt.order.transition({ to: OrderStatus.CONFIRMED, actorType: 'PROVIDER', occurredAt: NOW });
        PaymentTransactionEntity.succeed({
            paymentAttempt: attempt,
            type: PaymentTransactionType.CAPTURE,
            amount: '100',
            idempotencyKey: 'capture-1',
            providerTransactionId: 'tx-capture-1',
            processedAt: NOW,
        });
        const persistence = createPaymentService(attempt);

        await RequestContext.create(persistence.requestContextSource, () =>
            persistence.service.refund(
                ADMIN,
                {
                    paymentAttemptId: attempt.id,
                    amount: '40',
                    idempotencyKey: 'refund-1',
                    providerTransactionId: 'tx-r1',
                },
                NOW
            )
        );
        expect(attempt.status).toBe(PaymentAttemptStatus.PARTIALLY_REFUNDED);

        await expect(
            RequestContext.create(persistence.requestContextSource, () =>
                persistence.service.refund(
                    ADMIN,
                    {
                        paymentAttemptId: attempt.id,
                        amount: '61',
                        idempotencyKey: 'refund-too-much',
                        providerTransactionId: 'tx-r2',
                    },
                    NOW
                )
            )
        ).rejects.toThrow('환불 누적 금액은 매입 금액을 초과할 수 없습니다.');

        await RequestContext.create(persistence.requestContextSource, () =>
            persistence.service.refund(
                ADMIN,
                {
                    paymentAttemptId: attempt.id,
                    amount: '60',
                    idempotencyKey: 'refund-2',
                    providerTransactionId: 'tx-r3',
                },
                NOW
            )
        );
        expect(attempt.status).toBe(PaymentAttemptStatus.REFUNDED);
    });

    it('진행 중인 배송이 있으면 전액 환불을 거부한다', async () => {
        const { attempt } = createAttempt();
        attempt.capture(NOW);
        attempt.order.transition({ to: OrderStatus.CONFIRMED, actorType: 'PROVIDER', occurredAt: NOW });
        PaymentTransactionEntity.succeed({
            paymentAttempt: attempt,
            type: PaymentTransactionType.CAPTURE,
            amount: '100',
            idempotencyKey: 'capture-active-fulfillment',
            providerTransactionId: 'tx-capture-active-fulfillment',
            processedAt: NOW,
        });
        FulfillmentEntity.create(attempt.order, 'active-fulfillment', [
            { orderItem: attempt.order.items.getItems()[0], quantity: 1 },
        ]);
        const persistence = createPaymentService(attempt);

        await expect(
            RequestContext.create(persistence.requestContextSource, () =>
                persistence.service.refund(
                    ADMIN,
                    {
                        paymentAttemptId: attempt.id,
                        amount: '100',
                        idempotencyKey: 'refund-active-fulfillment',
                        providerTransactionId: 'tx-refund-active-fulfillment',
                    },
                    NOW
                )
            )
        ).rejects.toBeInstanceOf(ConflictException);
        expect(attempt.status).toBe(PaymentAttemptStatus.CAPTURED);
    });

    it('잘못된 결제 상태와 금액을 HTTP 예외로 번역한다', async () => {
        const { attempt } = createAttempt();
        attempt.capture(NOW);
        const persistence = createPaymentService(attempt);

        await expect(
            RequestContext.create(persistence.requestContextSource, () =>
                persistence.service.fail(
                    ADMIN,
                    {
                        paymentAttemptId: attempt.id,
                        idempotencyKey: 'fail-captured',
                        errorCode: 'PROVIDER_FAILURE',
                    },
                    NOW
                )
            )
        ).rejects.toBeInstanceOf(ConflictException);
        await expect(
            RequestContext.create(persistence.requestContextSource, () =>
                persistence.service.refund(
                    ADMIN,
                    {
                        paymentAttemptId: attempt.id,
                        amount: '0',
                        idempotencyKey: 'refund-zero',
                        providerTransactionId: 'tx-refund-zero',
                    },
                    NOW
                )
            )
        ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('동일한 Webhook 배달은 inbox 한 행만 만들고 payload가 바뀐 재사용은 거부한다', async () => {
        const { attempt } = createAttempt();
        let storedEvent: PaymentWebhookEventEntity | null = null;
        const persistence = createPaymentService(attempt, {
            findWebhook: jest.fn(async () => storedEvent),
            persist: jest.fn((entity: object) => {
                if (entity instanceof PaymentWebhookEventEntity) {
                    entity.id = 70n;
                    storedEvent = entity;
                }
            }),
        });
        const command = {
            provider: 'demo-pay',
            providerEventId: 'event-1',
            providerPaymentId: 'payment-1',
            payloadHash: 'a'.repeat(64),
        };

        const first = await RequestContext.create(persistence.requestContextSource, () =>
            persistence.service.receiveWebhook(command, NOW)
        );
        const replay = await RequestContext.create(persistence.requestContextSource, () =>
            persistence.service.receiveWebhook(command, NOW)
        );

        expect(replay.event).toBe(first.event);
        expect(first.event.status).toBe(PaymentWebhookEventStatus.RECEIVED);
        expect(persistence.persist).toHaveBeenCalledTimes(1);
        await expect(
            RequestContext.create(persistence.requestContextSource, () =>
                persistence.service.receiveWebhook({ ...command, payloadHash: 'b'.repeat(64) }, NOW)
            )
        ).rejects.toThrow('다른 payload');
    });

    it('HMAC verifier는 raw body에 대한 SHA-256 서명만 허용한다', () => {
        const verifier = new HmacPaymentWebhookSignatureVerifier({
            get: jest.fn(() => 'test-secret'),
        } as unknown as ConfigService<EnvConfig, true>);
        const rawBody = Buffer.from(JSON.stringify({ outcome: PaymentWebhookOutcome.CAPTURED }));
        const signature = createHmac('sha256', 'test-secret').update('demo-pay.event-1.').update(rawBody).digest('hex');

        expect(
            verifier.verify({
                provider: 'demo-pay',
                providerEventId: 'event-1',
                rawBody,
                signature: `sha256=${signature}`,
            })
        ).toBe(true);
        expect(
            verifier.verify({
                provider: 'demo-pay',
                providerEventId: 'event-2',
                rawBody,
                signature,
            })
        ).toBe(false);
    });
});

function createPaymentService(
    attempt: PaymentAttemptEntity,
    overrides: {
        readonly findWebhook?: () => Promise<PaymentWebhookEventEntity | null>;
        readonly persist?: (entity: object) => void;
    } = {}
) {
    const persist = jest.fn(overrides.persist ?? (() => undefined));
    const entityManager = Object.assign(Object.create(EntityManager.prototype), { persist }) as EntityManager;
    entityManager.lock = jest.fn(async () => undefined) as unknown as EntityManager['lock'];
    const transactional = jest.fn<
        (work: (entityManager: EntityManager) => Promise<unknown>, options?: TransactionOptions) => Promise<unknown>
    >(async (work) => work(entityManager));
    entityManager.transactional = transactional as unknown as EntityManager['transactional'];
    const requestContextSource = {
        name: 'default',
        fork: jest.fn(() => entityManager),
    } as unknown as EntityManager;
    const findTransaction = jest.fn<() => Promise<PaymentTransactionEntity | null>>().mockResolvedValue(null);
    const consumeForPayment = jest.fn((reservation: InventoryReservationEntity, now: Date) => reservation.consume(now));

    const service = new PaymentService(
        entityManager,
        { findOne: jest.fn(async () => attempt.order) } as unknown as EntityRepository<OrderEntity>,
        { findOne: jest.fn(async () => attempt) } as unknown as EntityRepository<PaymentAttemptEntity>,
        { findOne: findTransaction } as unknown as EntityRepository<PaymentTransactionEntity>,
        {
            findOne: overrides.findWebhook ?? jest.fn<() => Promise<null>>().mockResolvedValue(null),
        } as unknown as EntityRepository<PaymentWebhookEventEntity>,
        { consumeForPayment } as unknown as InventoryService
    );

    return { service, persist, findTransaction, consumeForPayment, requestContextSource };
}

function createAttempt(): { attempt: PaymentAttemptEntity; reservation: InventoryReservationEntity } {
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
    const orderItem = OrderItemEntity.create({ quantity: 1, item });
    orderItem.id = 30n;
    const order = OrderEntity.place({
        member: { id: 2n } as MemberEntity,
        orderNumber: 'order-1',
        idempotencyKey: 'payment-fixture-order',
        requestFingerprint: '0'.repeat(64),
        currencyCode: 'KRW',
        items: [orderItem],
        placedAt: NOW,
    });
    order.id = 40n;
    const reservation = InventoryReservationEntity.reserve(orderItem, new Date('2026-09-04T00:15:00.000Z'), NOW);
    reservation.id = 41n;
    const attempt = PaymentAttemptEntity.create({
        order,
        provider: 'demo-pay',
        idempotencyKey: 'attempt-1',
        providerPaymentId: 'payment-1',
    });
    attempt.id = 42n;
    return { attempt, reservation };
}
