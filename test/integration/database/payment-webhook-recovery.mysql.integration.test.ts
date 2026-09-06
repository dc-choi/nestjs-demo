import { type MikroORM as CoreMikroORM, type EntityManager, LockMode } from '@mikro-orm/core';
import { ReflectMetadataProvider } from '@mikro-orm/decorators/legacy';
import { MikroORM, MySqlDriver } from '@mikro-orm/mysql';
import { ConfigService } from '@nestjs/config';

import { createHash, createHmac } from 'node:crypto';
import {
    readMySqlIntegrationConnection,
    seedCatalogMaintenance,
} from 'test/integration/database/mysql-integration.config';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ItemEntity } from '~/api/catalog/domain/entity/item.entity';
import { InventoryService } from '~/api/inventory/application/inventory.service';
import { InventoryMovementEntity } from '~/api/inventory/domain/inventory-movement.entity';
import { InventoryReservationEntity } from '~/api/inventory/domain/inventory-reservation.entity';
import { MemberEntity } from '~/api/member/domain/member.entity';
import { OrderService } from '~/api/order/application/order.service';
import { OrderEntity } from '~/api/order/domain/entity/order.entity';
import { PaymentWebhookRecoveryRelay } from '~/api/payment/application/payment-webhook-recovery.relay';
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
import { PaymentWebhookController } from '~/api/payment/presentation/payment-webhook.controller';
import type { DistributedLockService } from '~/global/common/lock/distributed-lock.service';
import type { EnvConfig } from '~/global/config/env/env.config';
import type { JwtPayload } from '~/global/jwt/payload/jwt.payload';
import { databaseEntities } from '~/infra/database/entities';
import { DatabaseSeeder } from '~/infra/database/seeders/DatabaseSeeder';

const describeWebhookRecovery = process.env.MYSQL_INTEGRATION === '1' ? describe : describe.skip;

describeWebhookRecovery('Payment webhook recovery MySQL integration', () => {
    let orm: CoreMikroORM<MySqlDriver> | undefined;
    let customer: JwtPayload;
    let itemId: bigint;

    beforeAll(async () => {
        const connection = readMySqlIntegrationConnection();
        orm = await MikroORM.init<MySqlDriver>({
            driver: MySqlDriver,
            entities: [...databaseEntities],
            metadataProvider: ReflectMetadataProvider,
            ...connection,
            ensureDatabase: false,
            forceUtcTimezone: true,
            onReserveConnection: setSeoulSessionTimeZone,
            debug: false,
            pool: { min: 0, max: 8 },
        });
        const schemaDiff = await orm.schema.getUpdateSchemaSQL({ safe: true, dropTables: false });
        if (schemaDiff.trim().length > 0) {
            throw new Error(`Integration database does not match the applied migrations:\n${schemaDiff}`);
        }
        const [{ sessionTimeZone }] = await orm.em
            .fork()
            .execute<Array<{ sessionTimeZone: string }>>('SELECT @@session.time_zone AS sessionTimeZone');
        expect(sessionTimeZone).toBe('+09:00');
    }, 60_000);

    beforeEach(async () => {
        await orm!.schema.clear();
        await seedCatalogMaintenance(orm!.em.fork());
        await seedDatabase(orm!.em.fork());
        const item = await orm!.em.fork().findOneOrFail(ItemEntity, {
            sku: 'DEMO-KEYBOARD-BLACK-RED',
            product: { deletedAt: null },
            deletedAt: null,
        });
        const member = await orm!.em.fork().findOneOrFail(MemberEntity, { email: 'customer@demo-nest.local' });
        itemId = item.id;
        customer = { memberId: member.id, role: member.role };
    }, 60_000);

    afterAll(async () => {
        await orm?.close(true);
    });

    it('non-UTC DB에서 선행 환불 25개가 있어도 매입 Webhook을 굶기지 않는다', async () => {
        const services = createServices(orm!.em.fork({ useContext: true }));
        const placed = await services.order.order(customer, {
            idempotencyKey: 'refund-before-capture-order',
            items: [{ itemId, quantity: 1 }],
        });
        const capture = webhookCommand('refund-before-capture');
        const { attempt } = await services.payment.createAttempt(customer, {
            orderId: placed.id,
            provider: capture.provider,
            idempotencyKey: 'refund-before-capture-attempt',
            providerPaymentId: capture.providerPaymentId,
        });
        const refund = {
            ...capture,
            providerEventId: `${capture.providerEventId}-refund`,
            providerTransactionId: `${capture.providerTransactionId}-refund`,
            payloadHash: 'd'.repeat(64),
            outcome: PaymentWebhookOutcome.REFUNDED,
            amount: attempt.requestedAmount,
        };
        const refunds = Array.from({ length: 25 }, (_, index) => ({
            ...refund,
            providerEventId: `${refund.providerEventId}-${index}`,
        }));
        const events: PaymentWebhookEventEntity[] = [];
        for (const command of refunds) {
            const { event } = await services.payment.receiveVerifiedWebhook(command);
            events.push(event);
        }
        const relay = new PaymentWebhookRecoveryRelay(orm!, services.payment);
        await expect(relay.drainBatch()).resolves.toEqual({ claimed: 25, processed: 0, retried: 25, failed: 0 });
        await services.payment.receiveVerifiedWebhook(capture);
        await expect(relay.drainBatch()).resolves.toEqual({ claimed: 1, processed: 1, retried: 0, failed: 0 });
        await orm!.em
            .fork()
            .nativeUpdate(PaymentWebhookEventEntity, { id: events[0].id }, { nextRetryAt: new Date(0) });
        await expect(relay.drainBatch()).resolves.toEqual({ claimed: 1, processed: 1, retried: 0, failed: 0 });
        expect(await orm!.em.fork().findOneOrFail(PaymentAttemptEntity, { id: attempt.id })).toMatchObject({
            status: PaymentAttemptStatus.REFUNDED,
        });
        const transactions = await orm!.em
            .fork()
            .find(PaymentTransactionEntity, { paymentAttempt: attempt.id }, { orderBy: { id: 'asc' } });
        expect(transactions.map(({ type }) => type)).toEqual([
            PaymentTransactionType.CAPTURE,
            PaymentTransactionType.REFUND,
        ]);
        expect(await orm!.em.fork().findOneOrFail(PaymentWebhookEventEntity, { id: events[0].id })).toMatchObject({
            status: PaymentWebhookEventStatus.PROCESSED,
            retryCount: 0,
        });
    }, 30_000);

    it('HTTP가 처리를 완료하면 relay의 이전 대기 결과가 완료 상태를 되돌리지 않는다', async () => {
        const services = createServices(orm!.em.fork({ useContext: true }));
        const placed = await services.order.order(customer, {
            idempotencyKey: 'webhook-status-race-order',
            items: [{ itemId, quantity: 1 }],
        });
        const command = webhookCommand('webhook-status-race');
        await services.payment.receiveVerifiedWebhook(command);
        const recover = services.payment.recoverStoredWebhook.bind(services.payment);
        vi.spyOn(services.payment, 'recoverStoredWebhook').mockImplementationOnce(async (provider, eventId) => {
            const observed = await recover(provider, eventId);
            expect(observed.disposition).toBe('RETRY');
            const http = createServices(orm!.em.fork({ useContext: true }));
            await http.payment.createAttempt(customer, {
                orderId: placed.id,
                provider: command.provider,
                idempotencyKey: 'webhook-status-race-attempt',
                providerPaymentId: command.providerPaymentId,
            });
            await expect(http.payment.recoverStoredWebhook(provider, eventId)).resolves.toMatchObject({
                disposition: 'PROCESSED',
            });
            return observed;
        });
        const relay = new PaymentWebhookRecoveryRelay(orm!, services.payment);
        await expect(relay.drainBatch(1)).resolves.toEqual({ claimed: 1, processed: 0, retried: 0, failed: 0 });
        expect(
            await orm!.em.fork().findOneOrFail(PaymentWebhookEventEntity, { providerEventId: command.providerEventId })
        ).toMatchObject({ status: PaymentWebhookEventStatus.PROCESSED, retryCount: 0 });
    });

    it('결제 시도보다 먼저 받은 검증 이벤트를 재시작 뒤 매칭해 한 번만 매입한다', async () => {
        const receiving = createServices(orm!.em.fork({ useContext: true }));
        const placed = await receiving.order.order(customer, {
            idempotencyKey: 'webhook-recovery-early-order',
            items: [{ itemId, quantity: 1 }],
        });
        const command = webhookCommand('webhook-recovery-early');
        await receiving.payment.receiveVerifiedWebhook(command);

        const received = await orm!.em.fork().findOneOrFail(PaymentWebhookEventEntity, {
            provider: command.provider,
            providerEventId: command.providerEventId,
        });
        expect(received).toMatchObject({
            status: PaymentWebhookEventStatus.RECEIVED,
            providerPaymentId: command.providerPaymentId,
            outcome: PaymentWebhookOutcome.CAPTURED,
            providerTransactionId: command.providerTransactionId,
            retryCount: 0,
        });

        // More than ten missing-target polls must remain recoverable when an attempt arrives late.
        const waiting = new PaymentWebhookRecoveryRelay(orm!, receiving.payment);
        for (let poll = 0; poll < 12; poll += 1) {
            await orm!.em
                .fork()
                .nativeUpdate(PaymentWebhookEventEntity, { id: received.id }, { nextRetryAt: new Date(0) });
            await expect(waiting.drainBatch(1)).resolves.toMatchObject({ retried: 1, failed: 0 });
        }
        await orm!.em.fork().nativeUpdate(PaymentWebhookEventEntity, { id: received.id }, { nextRetryAt: new Date(0) });

        const lateAttempt = createServices(orm!.em.fork({ useContext: true }));
        await lateAttempt.payment.createAttempt(customer, {
            orderId: placed.id,
            provider: command.provider,
            idempotencyKey: 'webhook-recovery-early-attempt',
            providerPaymentId: command.providerPaymentId,
        });

        // A fresh EntityManager and relay represent a process restart after durable receipt.
        const restarted = createServices(orm!.em.fork({ useContext: true }));
        const relay = new PaymentWebhookRecoveryRelay(orm!, restarted.payment);
        await expect(relay.drainBatch(1)).resolves.toEqual({ claimed: 1, processed: 1, retried: 0, failed: 0 });

        const attempt = await orm!.em.fork().findOneOrFail(PaymentAttemptEntity, {
            provider: command.provider,
            providerPaymentId: command.providerPaymentId,
        });
        const transactions = await orm!.em.fork().find(PaymentTransactionEntity, { paymentAttempt: attempt.id });
        const event = await orm!.em.fork().findOneOrFail(PaymentWebhookEventEntity, { id: received.id });
        expect(attempt.status).toBe(PaymentAttemptStatus.CAPTURED);
        expect(transactions).toEqual([
            expect.objectContaining({
                type: PaymentTransactionType.CAPTURE,
                providerTransactionId: command.providerTransactionId,
            }),
        ]);
        expect(event).toMatchObject({ status: PaymentWebhookEventStatus.PROCESSED, retryCount: 0, leaseToken: null });
    }, 30_000);

    it('이전 hash-only 실패 이벤트도 서명 검증 재배달로 한 번만 복구한다', async () => {
        const services = createServices(orm!.em.fork({ useContext: true }));
        const placed = await services.order.order(customer, {
            idempotencyKey: 'webhook-legacy-failed-order',
            items: [{ itemId, quantity: 1 }],
        });
        const webhook = webhookCommand('webhook-legacy-failed');
        const body = {
            providerPaymentId: webhook.providerPaymentId,
            outcome: webhook.outcome,
            providerTransactionId: webhook.providerTransactionId,
        };
        const rawBody = Buffer.from(JSON.stringify(body));
        const payloadHash = createHash('sha256').update(rawBody).digest('hex');

        await services.payment.receiveWebhook({
            provider: webhook.provider,
            providerEventId: webhook.providerEventId,
            providerPaymentId: webhook.providerPaymentId,
            payloadHash,
        });
        await services.payment.failWebhook(webhook.provider, webhook.providerEventId, 'legacy missing attempt');
        expect(
            await orm!.em.fork().findOneOrFail(PaymentWebhookEventEntity, {
                provider: webhook.provider,
                providerEventId: webhook.providerEventId,
            })
        ).toMatchObject({
            status: PaymentWebhookEventStatus.FAILED,
            providerPaymentId: null,
            outcome: null,
        });

        const { attempt } = await services.payment.createAttempt(customer, {
            orderId: placed.id,
            provider: webhook.provider,
            idempotencyKey: 'webhook-legacy-failed-attempt',
            providerPaymentId: webhook.providerPaymentId,
        });
        const secret = 'mysql-webhook-legacy-failed-secret';
        const signature = createHmac('sha256', secret)
            .update(`${webhook.provider}.${webhook.providerEventId}.`)
            .update(rawBody)
            .digest('hex');
        const verifier = new HmacPaymentWebhookSignatureVerifier({
            get: () => secret,
        } as unknown as ConfigService<EnvConfig, true>);
        const redeliver = () =>
            new PaymentWebhookController(createServices(orm!.em.fork({ useContext: true })).payment, verifier).receive(
                webhook.provider,
                webhook.providerEventId,
                `sha256=${signature}`,
                { rawBody } as never,
                body
            );

        await expect(Promise.all([redeliver(), redeliver()])).resolves.toEqual([
            { eventId: webhook.providerEventId, status: PaymentWebhookEventStatus.PROCESSED },
            { eventId: webhook.providerEventId, status: PaymentWebhookEventStatus.PROCESSED },
        ]);

        expect(await orm!.em.fork().findOneOrFail(PaymentAttemptEntity, { id: attempt.id })).toMatchObject({
            status: PaymentAttemptStatus.CAPTURED,
        });
        expect(
            await orm!.em.fork().find(PaymentTransactionEntity, {
                paymentAttempt: attempt.id,
                type: PaymentTransactionType.CAPTURE,
            })
        ).toEqual([
            expect.objectContaining({
                providerTransactionId: webhook.providerTransactionId,
            }),
        ]);
        expect(
            await orm!.em.fork().findOneOrFail(PaymentWebhookEventEntity, {
                provider: webhook.provider,
                providerEventId: webhook.providerEventId,
            })
        ).toMatchObject({
            status: PaymentWebhookEventStatus.PROCESSED,
            retryCount: 0,
            leaseToken: null,
            leaseUntil: null,
            errorMessage: null,
        });
    }, 30_000);

    it('서명 검증 수신이 hash-only 경쟁 삽입을 만나도 검증 명령을 저장한다', async () => {
        const services = createServices(orm!.em.fork({ useContext: true }));
        const placed = await services.order.order(customer, {
            idempotencyKey: 'webhook-unique-race-order',
            items: [{ itemId, quantity: 1 }],
        });
        const webhook = webhookCommand('webhook-unique-race');
        const { attempt } = await services.payment.createAttempt(customer, {
            orderId: placed.id,
            provider: webhook.provider,
            idempotencyKey: 'webhook-unique-race-attempt',
            providerPaymentId: webhook.providerPaymentId,
        });
        const body = {
            providerPaymentId: webhook.providerPaymentId,
            outcome: webhook.outcome,
            providerTransactionId: webhook.providerTransactionId,
        };
        const rawBody = Buffer.from(JSON.stringify(body));
        const payloadHash = createHash('sha256').update(rawBody).digest('hex');
        const receivingEm = orm!.em.fork({ useContext: true });
        const receiving = createServices(receivingEm);
        const webhookRepository = receivingEm.getRepository(PaymentWebhookEventEntity);
        const originalFindOne = webhookRepository.findOne.bind(webhookRepository);
        vi.spyOn(webhookRepository, 'findOne').mockImplementationOnce(async () => {
            const existing = await originalFindOne(
                { provider: webhook.provider, providerEventId: webhook.providerEventId },
                { populate: ['paymentAttempt'], connectionType: 'write' }
            );
            expect(existing).toBeNull();
            await createServices(orm!.em.fork({ useContext: true })).payment.receiveWebhook({
                provider: webhook.provider,
                providerEventId: webhook.providerEventId,
                providerPaymentId: webhook.providerPaymentId,
                payloadHash,
            });
            return null;
        });
        const secret = 'mysql-webhook-unique-race-secret';
        const signature = createHmac('sha256', secret)
            .update(`${webhook.provider}.${webhook.providerEventId}.`)
            .update(rawBody)
            .digest('hex');
        const controller = new PaymentWebhookController(
            receiving.payment,
            new HmacPaymentWebhookSignatureVerifier({
                get: () => secret,
            } as unknown as ConfigService<EnvConfig, true>)
        );

        await expect(
            controller.receive(
                webhook.provider,
                webhook.providerEventId,
                `sha256=${signature}`,
                { rawBody } as never,
                body
            )
        ).resolves.toEqual({ eventId: webhook.providerEventId, status: PaymentWebhookEventStatus.PROCESSED });

        expect(await orm!.em.fork().findOneOrFail(PaymentAttemptEntity, { id: attempt.id })).toMatchObject({
            status: PaymentAttemptStatus.CAPTURED,
        });
        expect(
            await orm!.em.fork().find(PaymentTransactionEntity, {
                paymentAttempt: attempt.id,
                type: PaymentTransactionType.CAPTURE,
            })
        ).toEqual([
            expect.objectContaining({
                providerTransactionId: webhook.providerTransactionId,
            }),
        ]);
        expect(
            await orm!.em.fork().findOneOrFail(PaymentWebhookEventEntity, {
                provider: webhook.provider,
                providerEventId: webhook.providerEventId,
            })
        ).toMatchObject({
            status: PaymentWebhookEventStatus.PROCESSED,
            providerPaymentId: webhook.providerPaymentId,
            outcome: PaymentWebhookOutcome.CAPTURED,
        });
    }, 30_000);

    it('반복 배달과 동시 릴레이는 하나의 이벤트와 하나의 재무 효과로 수렴한다', async () => {
        const first = createServices(orm!.em.fork({ useContext: true }));
        const placed = await first.order.order(customer, {
            idempotencyKey: 'webhook-recovery-concurrent-order',
            items: [{ itemId, quantity: 1 }],
        });
        const command = webhookCommand('webhook-recovery-concurrent');
        await first.payment.createAttempt(customer, {
            orderId: placed.id,
            provider: command.provider,
            idempotencyKey: 'webhook-recovery-concurrent-attempt',
            providerPaymentId: command.providerPaymentId,
        });
        await Promise.all([
            first.payment.receiveVerifiedWebhook(command),
            createServices(orm!.em.fork({ useContext: true })).payment.receiveVerifiedWebhook(command),
        ]);

        const firstPayment = createServices(orm!.em.fork({ useContext: true })).payment;
        const recover = firstPayment.recoverStoredWebhook.bind(firstPayment);
        const entered = Promise.withResolvers<void>();
        const release = Promise.withResolvers<void>();
        vi.spyOn(firstPayment, 'recoverStoredWebhook').mockImplementationOnce(async (provider, eventId, now) => {
            entered.resolve();
            await release.promise;
            return recover(provider, eventId, now);
        });
        const firstRelay = new PaymentWebhookRecoveryRelay(orm!, firstPayment);
        const secondRelay = new PaymentWebhookRecoveryRelay(
            orm!,
            createServices(orm!.em.fork({ useContext: true })).payment
        );

        const firstDrain = firstRelay.drainBatch(1);
        try {
            await Promise.race([
                entered.promise,
                firstDrain.then(() => {
                    throw new Error('First relay finished before entering webhook recovery');
                }),
            ]);
            await expect(secondRelay.drainBatch(1)).resolves.toEqual({
                claimed: 0,
                processed: 0,
                retried: 0,
                failed: 0,
            });
        } finally {
            release.resolve();
            await Promise.allSettled([firstDrain]);
        }
        await expect(firstDrain).resolves.toEqual({ claimed: 1, processed: 1, retried: 0, failed: 0 });
        const events = await orm!.em.fork().find(PaymentWebhookEventEntity, {
            provider: command.provider,
            providerEventId: command.providerEventId,
        });
        const transactions = await orm!.em.fork().find(PaymentTransactionEntity, {
            paymentAttempt: { provider: command.provider, providerPaymentId: command.providerPaymentId },
        });
        expect(events).toEqual([expect.objectContaining({ status: PaymentWebhookEventStatus.PROCESSED })]);
        expect(transactions).toEqual([
            expect.objectContaining({
                type: PaymentTransactionType.CAPTURE,
                providerTransactionId: command.providerTransactionId,
            }),
        ]);
    }, 30_000);

    it('복구와 관리자 처리가 같은 잠금 순서로 한 번만 매입한다', async () => {
        const setup = createServices(orm!.em.fork({ useContext: true }));
        const placed = await setup.order.order(customer, {
            idempotencyKey: 'webhook-admin-recovery-lock-order',
            items: [{ itemId, quantity: 1 }],
        });
        const command = webhookCommand('webhook-admin-recovery-lock-order');
        const { attempt } = await setup.payment.createAttempt(customer, {
            orderId: placed.id,
            provider: command.provider,
            idempotencyKey: 'webhook-admin-recovery-lock-order',
            providerPaymentId: command.providerPaymentId,
        });
        await setup.payment.receiveVerifiedWebhook(command);

        const recoveryEm = orm!.em.fork({ useContext: true });
        const adminEm = orm!.em.fork({ useContext: true });
        const recovery = createServices(recoveryEm).payment;
        const admin = createServices(adminEm).payment;
        const recoveryRead = Promise.withResolvers<void>();
        const allowRecovery = Promise.withResolvers<void>();
        const adminLockedOrder = Promise.withResolvers<void>();
        const recoveryWebhookRepository = recoveryEm.getRepository(PaymentWebhookEventEntity);
        const adminOrderRepository = adminEm.getRepository(OrderEntity);
        const findRecoveryWebhook = recoveryWebhookRepository.findOne.bind(recoveryWebhookRepository);
        const findAdminOrder = adminOrderRepository.findOne.bind(adminOrderRepository);

        vi.spyOn(recoveryWebhookRepository, 'findOne').mockImplementationOnce(async () => {
            const event = await findRecoveryWebhook({
                provider: command.provider,
                providerEventId: command.providerEventId,
            });
            recoveryRead.resolve();
            await allowRecovery.promise;
            return event as never;
        });
        vi.spyOn(adminOrderRepository, 'findOne').mockImplementation(async () => {
            const order = await findAdminOrder(
                { id: placed.id, deletedAt: null },
                {
                    populate: ['member', 'items.inventoryReservation', 'fulfillments'],
                    connectionType: 'write',
                    lockMode: LockMode.PESSIMISTIC_WRITE,
                    refresh: true,
                }
            );
            adminLockedOrder.resolve();
            return order as never;
        });

        const recover = recovery.recoverStoredWebhook(command.provider, command.providerEventId);
        await recoveryRead.promise;
        const process = admin.processWebhook(command);
        await adminLockedOrder.promise;
        allowRecovery.resolve();

        await expect(Promise.all([recover, process])).resolves.toMatchObject([
            { disposition: 'PROCESSED', errorMessage: null },
            { event: { status: PaymentWebhookEventStatus.PROCESSED } },
        ]);
        expect(
            await orm!.em.fork().find(PaymentTransactionEntity, {
                paymentAttempt: attempt.id,
                type: PaymentTransactionType.CAPTURE,
            })
        ).toHaveLength(1);
    }, 30_000);

    it('관리자가 실패 처리한 이벤트를 늦은 복구가 다시 열지 않는다', async () => {
        const setup = createServices(orm!.em.fork({ useContext: true }));
        const placed = await setup.order.order(customer, {
            idempotencyKey: 'webhook-recovery-failed-race-order',
            items: [{ itemId, quantity: 1 }],
        });
        const command = webhookCommand('webhook-recovery-failed-race');
        const { attempt } = await setup.payment.createAttempt(customer, {
            orderId: placed.id,
            provider: command.provider,
            idempotencyKey: 'webhook-recovery-failed-race-attempt',
            providerPaymentId: command.providerPaymentId,
        });
        await setup.payment.receiveVerifiedWebhook(command);

        const recoveryEm = orm!.em.fork({ useContext: true });
        const recovery = createServices(recoveryEm).payment;
        const recoveryRead = Promise.withResolvers<void>();
        const allowRecovery = Promise.withResolvers<void>();
        const webhookRepository = recoveryEm.getRepository(PaymentWebhookEventEntity);
        const findWebhook = webhookRepository.findOne.bind(webhookRepository);
        vi.spyOn(webhookRepository, 'findOne').mockImplementationOnce(async () => {
            const event = await findWebhook({ provider: command.provider, providerEventId: command.providerEventId });
            recoveryRead.resolve();
            await allowRecovery.promise;
            return event as never;
        });

        const recover = recovery.recoverStoredWebhook(command.provider, command.providerEventId);
        await recoveryRead.promise;
        await setup.payment.failWebhook(command.provider, command.providerEventId, 'admin stopped recovery');
        allowRecovery.resolve();

        await expect(recover).resolves.toEqual({
            disposition: 'FAILED',
            errorMessage: 'admin stopped recovery',
        });
        expect(
            await orm!.em.fork().findOneOrFail(PaymentWebhookEventEntity, {
                provider: command.provider,
                providerEventId: command.providerEventId,
            })
        ).toMatchObject({ status: PaymentWebhookEventStatus.FAILED, errorMessage: 'admin stopped recovery' });
        expect(
            await orm!.em.fork().find(PaymentTransactionEntity, {
                paymentAttempt: attempt.id,
                type: PaymentTransactionType.CAPTURE,
            })
        ).toHaveLength(0);
    }, 30_000);
});

function createServices(em: EntityManager) {
    const inventory = new InventoryService(
        em,
        em.getRepository(ItemEntity),
        em.getRepository(InventoryReservationEntity),
        em.getRepository(InventoryMovementEntity)
    );
    return {
        order: new OrderService(
            em,
            em.getRepository(ItemEntity),
            em.getRepository(MemberEntity),
            em.getRepository(OrderEntity),
            inventory,
            passThroughLock()
        ),
        payment: new PaymentService(
            em,
            em.getRepository(OrderEntity),
            em.getRepository(PaymentAttemptEntity),
            em.getRepository(PaymentTransactionEntity),
            em.getRepository(PaymentWebhookEventEntity),
            inventory
        ),
    };
}

function webhookCommand(prefix: string) {
    return {
        provider: 'mysql-webhook-recovery',
        providerEventId: `${prefix}-event`,
        providerPaymentId: `${prefix}-payment`,
        payloadHash: 'd'.repeat(64),
        outcome: PaymentWebhookOutcome.CAPTURED,
        providerTransactionId: `${prefix}-capture`,
    };
}

interface SqlConnection {
    executeQuery(query: {
        readonly sql: string;
        readonly parameters: readonly unknown[];
        readonly queryId: symbol;
    }): Promise<unknown>;
}

async function setSeoulSessionTimeZone(connection: unknown): Promise<void> {
    await (connection as SqlConnection).executeQuery({
        sql: "SET time_zone = '+09:00'",
        parameters: [],
        queryId: Symbol('payment-webhook-recovery-test-time-zone'),
    });
}

function passThroughLock(): DistributedLockService {
    return {
        run: <T>(_resources: readonly string[], task: () => Promise<T>) => task(),
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
