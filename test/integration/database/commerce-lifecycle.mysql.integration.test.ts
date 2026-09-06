import { type MikroORM as CoreMikroORM, type EntityManager } from '@mikro-orm/core';
import { ReflectMetadataProvider } from '@mikro-orm/decorators/legacy';
import { MikroORM, MySqlDriver } from '@mikro-orm/mysql';
import { ConflictException } from '@nestjs/common';

import {
    readMySqlIntegrationConnection,
    seedCatalogMaintenance,
} from 'test/integration/database/mysql-integration.config';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ProductCommandService } from '~/api/catalog/application/product-command.service';
import { ItemEntity } from '~/api/catalog/domain/entity/item.entity';
import { FulfillmentService } from '~/api/fulfillment/application/fulfillment.service';
import { FulfillmentEntity } from '~/api/fulfillment/domain/fulfillment.entity';
import { FulfillmentStatus } from '~/api/fulfillment/domain/fulfillment.enum';
import { InventoryService } from '~/api/inventory/application/inventory.service';
import { InventoryMovementEntity } from '~/api/inventory/domain/inventory-movement.entity';
import { InventoryReservationEntity } from '~/api/inventory/domain/inventory-reservation.entity';
import { InventoryMovementType, InventoryReservationStatus } from '~/api/inventory/domain/inventory.enum';
import { MemberEntity } from '~/api/member/domain/member.entity';
import { OrderService } from '~/api/order/application/order.service';
import { OrderItemEntity } from '~/api/order/domain/entity/order-item.entity';
import { OrderStatusHistoryEntity } from '~/api/order/domain/entity/order-status-history.entity';
import { OrderEntity } from '~/api/order/domain/entity/order.entity';
import { OrderStatus } from '~/api/order/domain/entity/order.enum';
import { PaymentWebhookOutcome } from '~/api/payment/application/payment.command';
import { PaymentService } from '~/api/payment/application/payment.service';
import { PaymentAttemptEntity } from '~/api/payment/domain/payment-attempt.entity';
import { compareMoney } from '~/api/payment/domain/payment-money';
import { PaymentTransactionEntity } from '~/api/payment/domain/payment-transaction.entity';
import { PaymentWebhookEventEntity } from '~/api/payment/domain/payment-webhook-event.entity';
import {
    PaymentAttemptStatus,
    PaymentTransactionType,
    PaymentWebhookEventStatus,
} from '~/api/payment/domain/payment.enum';
import type { DistributedLockService } from '~/global/common/lock/distributed-lock.service';
import type { JwtPayload } from '~/global/jwt/payload/jwt.payload';
import { databaseEntities } from '~/infra/database/entities';
import { DatabaseSeeder } from '~/infra/database/seeders/DatabaseSeeder';

const describeCommerceMySql = process.env.MYSQL_INTEGRATION === '1' ? describe : describe.skip;

describeCommerceMySql('Commerce lifecycle MySQL integration', () => {
    let orm: CoreMikroORM<MySqlDriver> | undefined;
    let customer: JwtPayload;
    let admin: JwtPayload;
    let seller: JwtPayload;
    let itemId: bigint;
    let initialStock: number;

    beforeAll(async () => {
        const connection = readMySqlIntegrationConnection();
        orm = await MikroORM.init<MySqlDriver>({
            driver: MySqlDriver,
            entities: [...databaseEntities],
            metadataProvider: ReflectMetadataProvider,
            ...connection,
            ensureDatabase: false,
            forceUtcTimezone: true,
            debug: false,
            pool: { min: 0, max: 8 },
        });
        const schemaDiff = await orm.schema.getUpdateSchemaSQL({ safe: true, dropTables: false });
        if (schemaDiff.trim().length > 0) {
            throw new Error(`Integration database does not match the applied migrations:\n${schemaDiff}`);
        }
    }, 60_000);

    beforeEach(async () => {
        await orm!.schema.clear();
        await seedCatalogMaintenance(orm!.em.fork());
        await seedDatabase(orm!.em.fork());

        const fixture = await orm!.em
            .fork()
            .findOneOrFail(
                ItemEntity,
                { sku: 'DEMO-KEYBOARD-BLACK-RED', product: { deletedAt: null }, deletedAt: null },
                { populate: ['product'] }
            );
        const customerEntity = await orm!.em.fork().findOneOrFail(MemberEntity, {
            email: 'customer@demo-nest.local',
        });
        const sellerEntity = await orm!.em.fork().findOneOrFail(MemberEntity, { email: 'seller@demo-nest.local' });
        const adminEntity = await orm!.em.fork().findOneOrFail(MemberEntity, { email: 'admin@demo-nest.local' });
        itemId = fixture.id;
        initialStock = fixture.stock;
        customer = { memberId: customerEntity.id, role: customerEntity.role };
        seller = { memberId: sellerEntity.id, role: sellerEntity.role };
        admin = { memberId: adminEntity.id, role: adminEntity.role };
    }, 60_000);

    afterAll(async () => {
        await orm?.close(true);
    });

    it('seed live Item을 예약하고 매입한 뒤 두 배송 완료까지 원장과 상태 이력을 보존한다', async () => {
        const services = createServices(orm!.em.fork({ useContext: true }), passThroughLock());
        const placed = await services.order.order(customer, {
            idempotencyKey: 'mysql-completed-order',
            items: [{ itemId, quantity: 2 }],
        });
        const replay = await services.order.order(customer, {
            idempotencyKey: 'mysql-completed-order',
            items: [{ itemId, quantity: 2 }],
        });

        expect(replay.id).toBe(placed.id);
        await expect(
            services.order.order(customer, {
                idempotencyKey: 'mysql-completed-order',
                items: [{ itemId, quantity: 1 }],
            })
        ).rejects.toBeInstanceOf(ConflictException);

        const placedState = await readOrderState(orm!.em.fork(), placed.id);
        expect(placedState.order.status).toBe(OrderStatus.PENDING);
        expect(placedState.item.stock).toBe(initialStock - 2);
        expect(placedState.reservations).toHaveLength(1);
        expect(placedState.reservations[0]).toMatchObject({
            quantity: 2,
            status: InventoryReservationStatus.RESERVED,
        });
        expect(placedState.movements).toEqual([
            expect.objectContaining({
                type: InventoryMovementType.RESERVATION,
                quantityDelta: -2,
                stockAfter: initialStock - 2,
                referenceId: placed.orderNumber,
            }),
        ]);

        const attempt = await services.payment.createAttempt(customer, {
            orderId: placed.id,
            provider: 'mysql-provider',
            method: 'CARD',
            idempotencyKey: 'mysql-attempt-completed',
            providerPaymentId: 'mysql-payment-completed',
        });
        const capture = await services.payment.capture(admin, {
            paymentAttemptId: attempt.attempt.id,
            idempotencyKey: 'mysql-capture-completed',
            providerTransactionId: 'mysql-provider-capture-completed',
        });
        const providerReplay = await services.payment.capture(admin, {
            paymentAttemptId: attempt.attempt.id,
            idempotencyKey: 'mysql-capture-provider-replay',
            providerTransactionId: 'mysql-provider-capture-completed',
        });
        expect(providerReplay.transaction?.id).toBe(capture.transaction?.id);
        await expect(
            services.payment.refund(admin, {
                paymentAttemptId: attempt.attempt.id,
                amount: placed.totalPrice,
                idempotencyKey: 'mysql-refund-conflicting-provider-transaction',
                providerTransactionId: 'mysql-provider-capture-completed',
            })
        ).rejects.toBeInstanceOf(ConflictException);

        const orderItemId = placed.items[0].id;
        const first = await services.fulfillment.create(admin, {
            orderId: placed.id,
            idempotencyKey: 'mysql-first-fulfillment',
            items: [{ orderItemId, quantity: 1 }],
        });
        const second = await services.fulfillment.create(admin, {
            orderId: placed.id,
            idempotencyKey: 'mysql-second-fulfillment',
            items: [{ orderItemId, quantity: 1 }],
        });
        await deliver(services.fulfillment, admin, first.id, 'mysql-tracking-1');
        await deliver(services.fulfillment, admin, second.id, 'mysql-tracking-2');

        const completedState = await readOrderState(orm!.em.fork(), placed.id);
        expect(completedState.order.status).toBe(OrderStatus.COMPLETED);
        expect(completedState.order.completedAt).not.toBeNull();
        expect(completedState.item.stock).toBe(initialStock - 2);
        expect(completedState.reservations[0].status).toBe(InventoryReservationStatus.CONSUMED);
        expect(completedState.fulfillments).toHaveLength(2);
        expect(completedState.fulfillments.every(({ status }) => status === FulfillmentStatus.DELIVERED)).toBe(true);
        expect(completedState.attempts).toEqual([
            expect.objectContaining({ status: PaymentAttemptStatus.CAPTURED, requestedAmount: placed.totalPrice }),
        ]);
        expect(completedState.transactions).toEqual([
            expect.objectContaining({
                type: PaymentTransactionType.CAPTURE,
                amount: placed.totalPrice,
            }),
        ]);
        expect(completedState.histories.map(({ toStatus }) => toStatus)).toEqual([
            OrderStatus.PENDING,
            OrderStatus.CONFIRMED,
            OrderStatus.COMPLETED,
        ]);
    }, 30_000);

    it('동시 주문 생성을 한 주문으로 수렴시키고 취소 시 예약 재고를 정확히 한 번 복구한다', async () => {
        const locks = concurrentPassThroughLock(2);
        const firstServices = createServices(orm!.em.fork({ useContext: true }), locks);
        const secondServices = createServices(orm!.em.fork({ useContext: true }), locks);
        const command = {
            idempotencyKey: 'mysql-concurrent-cancelled-order',
            items: [{ itemId, quantity: 3 }],
        };

        const [first, second] = await Promise.all([
            firstServices.order.order(customer, command),
            secondServices.order.order(customer, command),
        ]);
        expect(second.id).toBe(first.id);

        const beforeCancel = await readOrderState(orm!.em.fork(), first.id);
        expect(beforeCancel.item.stock).toBe(initialStock - 3);
        expect(beforeCancel.reservations).toHaveLength(1);
        expect(beforeCancel.movements).toHaveLength(1);

        const cancelled = await firstServices.order.cancel(customer, {
            orderId: first.id,
            idempotencyKey: 'mysql-cancel-order',
            reason: 'MYSQL_INTEGRATION_CANCEL',
        });
        const replay = await firstServices.order.cancel(customer, {
            orderId: first.id,
            idempotencyKey: 'mysql-cancel-order',
            reason: 'MYSQL_INTEGRATION_CANCEL',
        });
        expect(replay.id).toBe(cancelled.id);

        const cancelledState = await readOrderState(orm!.em.fork(), first.id);
        expect(cancelledState.order.status).toBe(OrderStatus.CANCELLED);
        expect(cancelledState.item.stock).toBe(initialStock);
        expect(cancelledState.reservations[0].status).toBe(InventoryReservationStatus.RELEASED);
        expect(cancelledState.movements).toEqual([
            expect.objectContaining({ type: InventoryMovementType.RESERVATION, quantityDelta: -3 }),
            expect.objectContaining({
                type: InventoryMovementType.RELEASE,
                quantityDelta: 3,
                stockAfter: initialStock,
                reason: InventoryReservationStatus.RELEASED,
            }),
        ]);
        expect(cancelledState.histories.map(({ toStatus }) => toStatus)).toEqual([
            OrderStatus.PENDING,
            OrderStatus.CANCELLED,
        ]);
    }, 30_000);

    it('동일 Item 중복 라인의 합계로 재고를 판정하고 각 예약 원장을 순서대로 남긴다', async () => {
        const services = createServices(orm!.em.fork({ useContext: true }), passThroughLock());

        await expect(
            services.order.order(customer, {
                idempotencyKey: 'mysql-duplicate-lines-over-stock',
                items: [
                    { itemId, quantity: 13 },
                    { itemId, quantity: 13 },
                ],
            })
        ).rejects.toThrow('재고가 부족합니다.');
        expect(await orm!.em.fork().findOneOrFail(ItemEntity, itemId)).toMatchObject({ stock: initialStock });
        expect(await orm!.em.fork().count(OrderEntity, { idempotencyKey: 'mysql-duplicate-lines-over-stock' })).toBe(0);

        const placed = await services.order.order(customer, {
            idempotencyKey: 'mysql-duplicate-lines-valid',
            items: [
                { itemId, quantity: 2 },
                { itemId, quantity: 3 },
            ],
        });
        const state = await readOrderState(orm!.em.fork(), placed.id);
        expect(state.orderItems).toHaveLength(2);
        expect(state.reservations.map(({ quantity }) => quantity)).toEqual([2, 3]);
        expect(state.movements).toEqual([
            expect.objectContaining({
                type: InventoryMovementType.RESERVATION,
                quantityDelta: -2,
                stockAfter: initialStock - 2,
            }),
            expect.objectContaining({
                type: InventoryMovementType.RESERVATION,
                quantityDelta: -3,
                stockAfter: initialStock - 5,
            }),
        ]);
        expect(state.item.stock).toBe(initialStock - 5);
    }, 30_000);

    it('만료 배치는 한 주문의 모든 예약을 함께 복구하고 주문을 취소한다', async () => {
        const services = createServices(orm!.em.fork({ useContext: true }), passThroughLock());
        const placed = await services.order.order(customer, {
            idempotencyKey: 'mysql-expiring-order',
            items: [
                { itemId, quantity: 2 },
                { itemId, quantity: 3 },
            ],
        });
        const expiresAt = new Date(placed.placedAt!.getTime() + 15 * 60 * 1000);

        const result = await services.inventory.expireDueBatch(10, expiresAt);

        expect(result).toEqual({ selectedOrders: 1, expiredOrders: 1, failures: [] });
        const state = await readOrderState(orm!.em.fork(), placed.id);
        expect(state.order.status).toBe(OrderStatus.CANCELLED);
        expect(state.item.stock).toBe(initialStock);
        expect(state.reservations).toHaveLength(2);
        expect(state.reservations.every(({ status }) => status === InventoryReservationStatus.EXPIRED)).toBe(true);
        expect(
            state.movements.filter(
                ({ type, reason }) =>
                    type === InventoryMovementType.RELEASE && reason === InventoryReservationStatus.EXPIRED
            )
        ).toHaveLength(2);
        expect(state.histories.at(-1)).toMatchObject({
            toStatus: OrderStatus.CANCELLED,
            reason: 'INVENTORY_RESERVATION_EXPIRED',
        });
    }, 30_000);

    it('배송 생성은 같은 요청으로 수렴하고 진행 중인 배송은 전액 환불을 막는다', async () => {
        const services = createServices(orm!.em.fork({ useContext: true }), passThroughLock());
        const placed = await services.order.order(customer, {
            idempotencyKey: 'mysql-fulfillment-idempotency-order',
            items: [{ itemId, quantity: 2 }],
        });
        const attempt = await services.payment.createAttempt(customer, {
            orderId: placed.id,
            provider: 'mysql-fulfillment-provider',
            idempotencyKey: 'mysql-fulfillment-attempt',
            providerPaymentId: 'mysql-fulfillment-payment',
        });
        await services.payment.capture(admin, {
            paymentAttemptId: attempt.attempt.id,
            idempotencyKey: 'mysql-fulfillment-capture',
            providerTransactionId: 'mysql-fulfillment-capture-transaction',
        });
        const command = {
            orderId: placed.id,
            idempotencyKey: 'mysql-idempotent-fulfillment',
            items: [{ orderItemId: placed.items[0].id, quantity: 1 }],
        };
        const [first, replay] = await Promise.all([
            createServices(orm!.em.fork({ useContext: true }), passThroughLock()).fulfillment.create(admin, command),
            createServices(orm!.em.fork({ useContext: true }), passThroughLock()).fulfillment.create(admin, command),
        ]);
        expect(replay.id).toBe(first.id);
        await expect(
            services.payment.refund(admin, {
                paymentAttemptId: attempt.attempt.id,
                amount: placed.totalPrice,
                idempotencyKey: 'mysql-fulfillment-full-refund',
                providerTransactionId: 'mysql-fulfillment-refund-transaction',
            })
        ).rejects.toBeInstanceOf(ConflictException);
        expect(await orm!.em.fork().count(FulfillmentEntity, { order: placed.id })).toBe(1);
    }, 30_000);

    it('배송 생성과 전액 환불이 경합해도 둘 중 하나만 성공한다', async () => {
        const setup = createServices(orm!.em.fork({ useContext: true }), passThroughLock());
        const placed = await setup.order.order(customer, {
            idempotencyKey: 'mysql-refund-fulfillment-race-order',
            items: [{ itemId, quantity: 1 }],
        });
        const attempt = await setup.payment.createAttempt(customer, {
            orderId: placed.id,
            provider: 'mysql-refund-fulfillment-race-provider',
            idempotencyKey: 'mysql-refund-fulfillment-race-attempt',
            providerPaymentId: 'mysql-refund-fulfillment-race-payment',
        });
        await setup.payment.capture(admin, {
            paymentAttemptId: attempt.attempt.id,
            idempotencyKey: 'mysql-refund-fulfillment-race-capture',
            providerTransactionId: 'mysql-refund-fulfillment-race-capture-transaction',
        });

        const creation = createServices(orm!.em.fork({ useContext: true }), passThroughLock()).fulfillment.create(
            admin,
            {
                orderId: placed.id,
                idempotencyKey: 'mysql-refund-fulfillment-race-create',
                items: [{ orderItemId: placed.items[0].id, quantity: 1 }],
            }
        );
        const refund = createServices(orm!.em.fork({ useContext: true }), passThroughLock()).payment.refund(admin, {
            paymentAttemptId: attempt.attempt.id,
            amount: placed.totalPrice,
            idempotencyKey: 'mysql-refund-fulfillment-race-refund',
            providerTransactionId: 'mysql-refund-fulfillment-race-refund-transaction',
        });
        const [creationResult, refundResult] = await Promise.allSettled([creation, refund]);

        expect([creationResult, refundResult].filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
        const rejected = [creationResult, refundResult].find(({ status }) => status === 'rejected');
        expect(rejected).toMatchObject({ reason: expect.any(ConflictException) });

        const state = await readOrderState(orm!.em.fork(), placed.id);
        if (creationResult.status === 'fulfilled') {
            expect(state.fulfillments).toHaveLength(1);
            expect(state.attempts[0].status).toBe(PaymentAttemptStatus.CAPTURED);
        } else {
            expect(state.fulfillments).toHaveLength(0);
            expect(state.attempts[0].status).toBe(PaymentAttemptStatus.REFUNDED);
        }
    }, 30_000);

    it('전액 환불 후 주문 취소가 CONSUMED 예약을 RETURN 원장으로 한 번만 복구한다', async () => {
        const services = createServices(orm!.em.fork({ useContext: true }), passThroughLock());
        const placed = await services.order.order(customer, {
            idempotencyKey: 'mysql-refunded-order',
            items: [{ itemId, quantity: 2 }],
        });
        const attempt = await services.payment.createAttempt(customer, {
            orderId: placed.id,
            provider: 'mysql-refund-provider',
            method: 'CARD',
            idempotencyKey: 'mysql-refund-attempt',
            providerPaymentId: 'mysql-refund-payment',
        });
        await services.payment.capture(admin, {
            paymentAttemptId: attempt.attempt.id,
            idempotencyKey: 'mysql-refund-capture',
            providerTransactionId: 'mysql-refund-capture-transaction',
        });
        await services.payment.refund(admin, {
            paymentAttemptId: attempt.attempt.id,
            amount: placed.totalPrice,
            idempotencyKey: 'mysql-full-refund',
            providerTransactionId: 'mysql-full-refund-transaction',
        });

        const cancelCommand = {
            orderId: placed.id,
            idempotencyKey: 'mysql-refunded-order-cancel',
            reason: 'MYSQL_FULL_REFUND_CANCEL',
        };
        await services.order.cancel(customer, cancelCommand);
        await services.order.cancel(customer, cancelCommand);

        const state = await readOrderState(orm!.em.fork(), placed.id);
        expect(state.order.status).toBe(OrderStatus.CANCELLED);
        expect(state.item.stock).toBe(initialStock);
        expect(state.reservations).toEqual([
            expect.objectContaining({ status: InventoryReservationStatus.RELEASED, quantity: 2 }),
        ]);
        expect(state.movements).toEqual([
            expect.objectContaining({ type: InventoryMovementType.RESERVATION, quantityDelta: -2 }),
            expect.objectContaining({
                type: InventoryMovementType.RETURN,
                quantityDelta: 2,
                stockAfter: initialStock,
                reason: 'ORDER_CANCELLED_AFTER_REFUND',
            }),
        ]);
        expect(state.transactions.map(({ type }) => type)).toEqual([
            PaymentTransactionType.CAPTURE,
            PaymentTransactionType.REFUND,
        ]);
        expect(state.histories.map(({ toStatus }) => toStatus)).toEqual([
            OrderStatus.PENDING,
            OrderStatus.CONFIRMED,
            OrderStatus.CANCELLED,
        ]);
    }, 30_000);

    it('Catalog이 Item을 soft-delete한 후에도 주문 취소가 예약 재고를 복구한다', async () => {
        const services = createServices(orm!.em.fork({ useContext: true }), passThroughLock());
        const placed = await services.order.order(customer, {
            idempotencyKey: 'mysql-soft-deleted-item-order',
            items: [{ itemId, quantity: 1 }],
        });
        const catalogEm = orm!.em.fork({ useContext: true });
        const item = await catalogEm.findOneOrFail(ItemEntity, itemId, { populate: ['product'] });
        await new ProductCommandService(catalogEm).deleteItem(seller, {
            productId: item.product.id,
            itemId,
            expectedRevision: item.product.revision,
            reason: 'MYSQL_SOFT_DELETE_AFTER_RESERVATION',
        });

        await services.order.cancel(customer, {
            orderId: placed.id,
            idempotencyKey: 'mysql-soft-deleted-item-cancel',
        });

        const state = await readOrderState(orm!.em.fork(), placed.id);
        expect(state.order.status).toBe(OrderStatus.CANCELLED);
        expect(state.item).toMatchObject({ stock: initialStock });
        expect(state.item.deletedAt).not.toBeNull();
        expect(state.reservations[0].status).toBe(InventoryReservationStatus.RELEASED);
    }, 30_000);

    it('동시 결제 시도 생성을 provider 멱등성 키의 한 행으로 수렴시킨다', async () => {
        const placement = createServices(orm!.em.fork({ useContext: true }), passThroughLock());
        const placed = await placement.order.order(customer, {
            idempotencyKey: 'mysql-concurrent-payment-order',
            items: [{ itemId, quantity: 1 }],
        });
        const command = {
            orderId: placed.id,
            provider: 'mysql-concurrent-provider',
            method: 'CARD',
            idempotencyKey: 'mysql-concurrent-attempt',
            providerPaymentId: 'mysql-concurrent-payment',
        };
        const first = createServices(orm!.em.fork({ useContext: true }), passThroughLock());
        const second = createServices(orm!.em.fork({ useContext: true }), passThroughLock());

        const [left, right] = await Promise.all([
            first.payment.createAttempt(customer, command),
            second.payment.createAttempt(customer, command),
        ]);

        expect(right.attempt.id).toBe(left.attempt.id);
        expect(
            await orm!.em.fork().count(PaymentAttemptEntity, {
                provider: command.provider,
                idempotencyKey: command.idempotencyKey,
            })
        ).toBe(1);
        await expect(
            createServices(orm!.em.fork({ useContext: true }), passThroughLock()).payment.createAttempt(customer, {
                ...command,
                idempotencyKey: 'mysql-conflicting-attempt',
            })
        ).rejects.toBeInstanceOf(ConflictException);
        expect(
            await orm!.em.fork().count(PaymentAttemptEntity, {
                provider: command.provider,
                providerPaymentId: command.providerPaymentId,
            })
        ).toBe(1);
    }, 30_000);

    it('새 EntityManager에서도 동일 Webhook을 inbox와 매입 거래 한 행으로 수렴시킨다', async () => {
        const placement = createServices(orm!.em.fork({ useContext: true }), passThroughLock());
        const placed = await placement.order.order(customer, {
            idempotencyKey: 'mysql-webhook-order',
            items: [{ itemId, quantity: 1 }],
        });
        await placement.payment.createAttempt(customer, {
            orderId: placed.id,
            provider: 'mysql-webhook-provider',
            idempotencyKey: 'mysql-webhook-attempt',
            providerPaymentId: 'mysql-webhook-payment',
        });

        const webhook = createServices(orm!.em.fork({ useContext: true }), passThroughLock());
        const receivedCommand = {
            provider: 'mysql-webhook-provider',
            providerEventId: 'mysql-webhook-event',
            providerPaymentId: 'mysql-webhook-payment',
            payloadHash: 'a'.repeat(64),
        };
        const received = await webhook.payment.receiveWebhook(receivedCommand);
        const receivedReplay = await webhook.payment.receiveWebhook(receivedCommand);
        expect(receivedReplay.event.id).toBe(received.event.id);

        const processedCommand = {
            ...receivedCommand,
            outcome: PaymentWebhookOutcome.CAPTURED,
            providerTransactionId: 'mysql-webhook-capture',
        };
        const processed = await webhook.payment.processWebhook(processedCommand);
        const processedReplay = await webhook.payment.processWebhook(processedCommand);
        expect(processedReplay.event.id).toBe(processed.event.id);
        expect(processedReplay.transaction?.id).toBe(processed.transaction?.id);

        const state = await readOrderState(orm!.em.fork(), placed.id);
        expect(state.order.status).toBe(OrderStatus.CONFIRMED);
        expect(state.reservations[0].status).toBe(InventoryReservationStatus.CONSUMED);
        expect(state.transactions).toHaveLength(1);
        expect(state.transactions[0].type).toBe(PaymentTransactionType.CAPTURE);
        expect(compareMoney(state.transactions[0].amount, placed.totalPrice)).toBe(0);
        const events = await orm!.em.fork().find(PaymentWebhookEventEntity, {
            provider: receivedCommand.provider,
            providerEventId: receivedCommand.providerEventId,
        });
        expect(events.map(({ status }) => status)).toEqual([PaymentWebhookEventStatus.PROCESSED]);
    }, 30_000);
});

function createServices(em: EntityManager, distributedLock: DistributedLockService) {
    const inventory = new InventoryService(
        em,
        em.getRepository(ItemEntity),
        em.getRepository(InventoryReservationEntity),
        em.getRepository(InventoryMovementEntity)
    );
    return {
        inventory,
        order: new OrderService(
            em,
            em.getRepository(ItemEntity),
            em.getRepository(MemberEntity),
            em.getRepository(OrderEntity),
            inventory,
            distributedLock
        ),
        payment: new PaymentService(
            em,
            em.getRepository(OrderEntity),
            em.getRepository(PaymentAttemptEntity),
            em.getRepository(PaymentTransactionEntity),
            em.getRepository(PaymentWebhookEventEntity),
            inventory
        ),
        fulfillment: new FulfillmentService(em, em.getRepository(OrderEntity), em.getRepository(FulfillmentEntity)),
    };
}

async function readOrderState(em: EntityManager, orderId: bigint) {
    const order = await em.findOneOrFail(OrderEntity, { id: orderId });
    const orderItems = await em.find(
        OrderItemEntity,
        { order: orderId },
        { populate: ['item'], orderBy: { id: 'asc' } }
    );
    const item = await em.findOneOrFail(ItemEntity, { id: orderItems[0].item.id });
    const reservations = await em.find(
        InventoryReservationEntity,
        { orderItem: { order: orderId } },
        { orderBy: { id: 'asc' } }
    );
    const reservationIds = new Set(reservations.map(({ id }) => id.toString()));
    const movements = (await em.find(InventoryMovementEntity, { item: item.id }, { orderBy: { id: 'asc' } })).filter(
        ({ referenceType, referenceId }) =>
            referenceId === order.orderNumber ||
            (referenceType === 'INVENTORY_RESERVATION' && referenceId != null && reservationIds.has(referenceId))
    );
    return {
        order,
        orderItems,
        item,
        reservations,
        movements,
        attempts: await em.find(PaymentAttemptEntity, { order: orderId }, { orderBy: { id: 'asc' } }),
        transactions: await em.find(
            PaymentTransactionEntity,
            { paymentAttempt: { order: orderId } },
            { orderBy: { id: 'asc' } }
        ),
        fulfillments: await em.find(FulfillmentEntity, { order: orderId }, { orderBy: { id: 'asc' } }),
        histories: await em.find(OrderStatusHistoryEntity, { order: orderId }, { orderBy: { id: 'asc' } }),
    };
}

async function deliver(
    fulfillmentService: FulfillmentService,
    actor: JwtPayload,
    fulfillmentId: bigint,
    trackingNumber: string
): Promise<void> {
    await fulfillmentService.pack(actor, fulfillmentId);
    await fulfillmentService.ship(actor, { fulfillmentId, carrier: 'mysql-carrier', trackingNumber });
    await fulfillmentService.deliver(actor, fulfillmentId);
}

function passThroughLock(): DistributedLockService {
    return {
        run: <T>(_resources: readonly string[], task: () => Promise<T>) => task(),
    } as unknown as DistributedLockService;
}

function concurrentPassThroughLock(participants: number): DistributedLockService {
    let arrivals = 0;
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    return {
        run: async <T>(_resources: readonly string[], task: () => Promise<T>) => {
            arrivals += 1;
            if (arrivals === participants) release?.();
            await gate;
            return task();
        },
    } as unknown as DistributedLockService;
}

async function seedDatabase(em: EntityManager): Promise<void> {
    const previousPassword = process.env.DEMO_SEED_PASSWORD;
    const previousSecret = process.env.SECRET;
    process.env.DEMO_SEED_PASSWORD = 'mysql-integration-password';
    process.env.SECRET = 'mysql-integration-secret';
    try {
        await new DatabaseSeeder().run(em);
    } finally {
        restoreEnvironment('DEMO_SEED_PASSWORD', previousPassword);
        restoreEnvironment('SECRET', previousSecret);
    }
}

function restoreEnvironment(name: string, value: string | undefined): void {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
}
