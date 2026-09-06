import {
    EntityManager,
    type EntityRepository,
    RequestContext,
    UniqueConstraintViolationException,
} from '@mikro-orm/core';

import { describe, expect, it, vi } from 'vitest';
import { OrderEntity } from '~/api/order/domain/entity/order.entity';
import type { PaymentInventoryPort } from '~/api/payment/application/payment-inventory.port';
import { PaymentWebhookRecoveryRelay } from '~/api/payment/application/payment-webhook-recovery.relay';
import { PaymentWebhookOutcome } from '~/api/payment/application/payment.command';
import { PaymentService } from '~/api/payment/application/payment.service';
import { PaymentAttemptEntity } from '~/api/payment/domain/payment-attempt.entity';
import { PaymentTransactionEntity } from '~/api/payment/domain/payment-transaction.entity';
import { PaymentWebhookEventEntity } from '~/api/payment/domain/payment-webhook-event.entity';
import { PaymentWebhookEventStatus } from '~/api/payment/domain/payment.enum';

const NOW = new Date('2026-09-05T00:00:00.000Z');
const verifiedCommand = {
    provider: 'demo-pay',
    providerEventId: 'event-before-attempt',
    providerPaymentId: 'provider-payment-1',
    payloadHash: 'a'.repeat(64),
    outcome: PaymentWebhookOutcome.CAPTURED,
    providerTransactionId: 'provider-transaction-1',
};

describe('payment webhook recovery', () => {
    it('관리용 처리도 저장된 서명 검증 명령의 outcome을 바꾸지 못한다', async () => {
        const event = PaymentWebhookEventEntity.receive({ ...verifiedCommand, verifiedCommand });
        const persistence = createPaymentService({ findWebhook: async () => event });
        await expect(
            inRequestContext(persistence.requestContextSource, () =>
                persistence.service.processWebhook({
                    ...verifiedCommand,
                    outcome: PaymentWebhookOutcome.FAILED,
                    errorCode: 'DECLINED',
                })
            )
        ).rejects.toThrow('다른 검증 명령');
        expect(event.status).toBe(PaymentWebhookEventStatus.RECEIVED);
    });
    it('실패 진단을 제한된 길이로 보존해 저장된 명령으로 복원한다', () => {
        const event = PaymentWebhookEventEntity.receive({
            ...verifiedCommand,
            verifiedCommand: {
                ...verifiedCommand,
                outcome: PaymentWebhookOutcome.FAILED,
                errorCode: 'DECLINED',
                errorMessage: 'x'.repeat(1_001),
            },
        });
        expect(event.verifiedCommand()).toMatchObject({ errorCode: 'DECLINED', errorMessage: 'x'.repeat(1_000) });
    });
    it('선도착한 검증 이벤트를 보존하고 결제 시도가 생긴 뒤 저장된 명령으로 한 번만 재처리한다', async () => {
        let event: PaymentWebhookEventEntity | null = null;
        let attempt: PaymentAttemptEntity | null = null;
        const findWebhook = vi.fn(async () => event);
        const persistence = createPaymentService({
            findWebhook,
            findAttempt: vi.fn(async (where: Record<string, unknown>) =>
                'providerPaymentId' in where ? attempt : null
            ),
            persist: vi.fn((entity: object) => {
                if (entity instanceof PaymentWebhookEventEntity) {
                    entity.id = 100n;
                    event = entity;
                }
            }),
        });

        const received = await inRequestContext(persistence.requestContextSource, () =>
            persistence.service.receiveVerifiedWebhook(verifiedCommand, NOW)
        );
        expect(received.event.verifiedCommand()).toMatchObject(verifiedCommand);

        await expect(
            inRequestContext(persistence.requestContextSource, () =>
                persistence.service.recoverStoredWebhook(verifiedCommand.provider, verifiedCommand.providerEventId, NOW)
            )
        ).resolves.toMatchObject({ disposition: 'RETRY' });
        expect(findWebhook.mock.calls[1]).toEqual([
            { provider: verifiedCommand.provider, providerEventId: verifiedCommand.providerEventId },
            { connectionType: 'write', refresh: true },
        ]);

        attempt = { id: 200n } as PaymentAttemptEntity;
        const process = vi.spyOn(persistence.service, 'processWebhook').mockImplementation(async () => {
            event!.status = PaymentWebhookEventStatus.PROCESSED;
            return { event: event!, transaction: null };
        });
        await inRequestContext(persistence.requestContextSource, () =>
            persistence.service.recoverStoredWebhook(verifiedCommand.provider, verifiedCommand.providerEventId, NOW)
        );
        await inRequestContext(persistence.requestContextSource, () =>
            persistence.service.recoverStoredWebhook(verifiedCommand.provider, verifiedCommand.providerEventId, NOW)
        );

        expect(process).toHaveBeenCalledTimes(1);
        expect(process).toHaveBeenCalledWith(expect.objectContaining(verifiedCommand), NOW, {
            rejectFailedEvent: true,
        });
    });

    it('반복 배달은 하나의 검증 명령만 유지하고 다른 명령으로 덮어쓰지 못한다', async () => {
        let event: PaymentWebhookEventEntity | null = null;
        const persistence = createPaymentService({
            findWebhook: vi.fn(async () => event),
            persist: vi.fn((entity: object) => {
                if (entity instanceof PaymentWebhookEventEntity) event = entity;
            }),
        });

        const received = await inRequestContext(persistence.requestContextSource, () =>
            persistence.service.receiveVerifiedWebhook(verifiedCommand, NOW)
        );
        await inRequestContext(persistence.requestContextSource, () =>
            persistence.service.receiveVerifiedWebhook(verifiedCommand, NOW)
        );
        await expect(
            inRequestContext(persistence.requestContextSource, () =>
                persistence.service.receiveVerifiedWebhook(
                    { ...verifiedCommand, providerTransactionId: 'other-transaction' },
                    NOW
                )
            )
        ).rejects.toThrow('다른 검증 명령');

        expect(persistence.persist).toHaveBeenCalledTimes(1);
        expect(received.event.verifiedCommand()?.providerTransactionId).toBe(verifiedCommand.providerTransactionId);
    });

    it('기존 실패 이벤트는 첫 검증 재전송으로 실패 상태를 지우고 즉시 복구한다', async () => {
        const event = PaymentWebhookEventEntity.receive(verifiedCommand);
        event.id = 100n;
        event.failed('Webhook 대상 결제 시도를 찾을 수 없습니다.', new Date(0));
        event.retryCount = 10;
        event.nextRetryAt = new Date(NOW.getTime() + 60_000);
        event.leaseToken = 'stale-lease';
        event.leaseUntil = event.nextRetryAt;
        const persistence = createPaymentService({
            findWebhook: async () => event,
            findAttempt: async () => ({ id: 200n }) as PaymentAttemptEntity,
        });

        await inRequestContext(persistence.requestContextSource, () =>
            persistence.service.receiveVerifiedWebhook(verifiedCommand, NOW)
        );
        expect(event).toMatchObject({
            status: PaymentWebhookEventStatus.RECEIVED,
            processedAt: null,
            errorMessage: null,
            retryCount: 0,
            nextRetryAt: NOW,
            leaseToken: null,
            leaseUntil: null,
        });
        const process = vi.spyOn(persistence.service, 'processWebhook').mockImplementation(async () => {
            event.status = PaymentWebhookEventStatus.PROCESSED;
            return { event, transaction: null };
        });
        await expect(
            inRequestContext(persistence.requestContextSource, () =>
                persistence.service.recoverStoredWebhook(event.provider, event.providerEventId, NOW)
            )
        ).resolves.toEqual({ disposition: 'PROCESSED', errorMessage: null });
        expect(process).toHaveBeenCalledOnce();
    });

    it.each([
        { status: PaymentWebhookEventStatus.FAILED, storedCommand: verifiedCommand },
        { status: PaymentWebhookEventStatus.PROCESSED, storedCommand: null },
    ])('재전송이 기존 $status 확정 결과를 다시 열지 않는다', async ({ status, storedCommand }) => {
        const event = PaymentWebhookEventEntity.receive({ ...verifiedCommand, verifiedCommand: storedCommand });
        event.id = 100n;
        event.status = status;
        event.processedAt = new Date(0);
        event.errorMessage = status === PaymentWebhookEventStatus.FAILED ? 'recovery exhausted' : null;
        event.retryCount = 10;
        const persistence = createPaymentService({ findWebhook: async () => event });

        await inRequestContext(persistence.requestContextSource, () =>
            persistence.service.receiveVerifiedWebhook(verifiedCommand, NOW)
        );
        expect(event).toMatchObject({ status, processedAt: new Date(0), retryCount: 10 });
    });

    it('기존 실패 이벤트와 다른 payload의 재전송은 복구 상태를 변경하지 않는다', async () => {
        const event = PaymentWebhookEventEntity.receive(verifiedCommand);
        event.id = 100n;
        event.failed('missing attempt', new Date(0));
        const persistence = createPaymentService({ findWebhook: async () => event });

        await expect(
            inRequestContext(persistence.requestContextSource, () =>
                persistence.service.receiveVerifiedWebhook({ ...verifiedCommand, payloadHash: 'b'.repeat(64) }, NOW)
            )
        ).rejects.toThrow('다른 payload');
        expect(event.status).toBe(PaymentWebhookEventStatus.FAILED);
        expect(event.verifiedCommand()).toBeNull();
    });

    it('기존 수신이 INSERT 경합에서 먼저 저장한 행에도 검증 명령을 보존한다', async () => {
        const event = PaymentWebhookEventEntity.receive(verifiedCommand);
        event.id = 100n;
        const findWebhook = vi.fn(async () => event as PaymentWebhookEventEntity | null);
        findWebhook.mockResolvedValueOnce(null);
        const persistence = createPaymentService({
            findWebhook,
            persist: () => {
                throw new UniqueConstraintViolationException(new Error('Duplicate entry'));
            },
        });

        await inRequestContext(persistence.requestContextSource, () =>
            persistence.service.receiveVerifiedWebhook(verifiedCommand, NOW)
        );
        expect(event.verifiedCommand()).toMatchObject(verifiedCommand);
        expect(event.status).toBe(PaymentWebhookEventStatus.RECEIVED);
    });

    it('복구할 수 없는 검증 명령과 기존 hash-only 행을 재시도 대상으로 처리하지 않는다', async () => {
        const poison = PaymentWebhookEventEntity.receive({
            provider: 'demo-pay',
            providerEventId: 'poison-event',
            payloadHash: 'b'.repeat(64),
            verifiedCommand: { ...verifiedCommand, providerPaymentId: null },
            receivedAt: NOW,
        });
        const legacy = PaymentWebhookEventEntity.receive({
            provider: 'demo-pay',
            providerEventId: 'legacy-event',
            payloadHash: 'c'.repeat(64),
            receivedAt: NOW,
        });
        const persistence = createPaymentService({
            findWebhook: vi.fn(async (where: Record<string, unknown>) =>
                where.providerEventId === poison.providerEventId ? poison : legacy
            ),
        });

        await expect(
            inRequestContext(persistence.requestContextSource, () =>
                persistence.service.recoverStoredWebhook(poison.provider, poison.providerEventId, NOW)
            )
        ).resolves.toMatchObject({ disposition: 'FAILED' });
        await expect(
            inRequestContext(persistence.requestContextSource, () =>
                persistence.service.recoverStoredWebhook(legacy.provider, legacy.providerEventId, NOW)
            )
        ).resolves.toMatchObject({ disposition: 'FAILED' });
    });

    it('결제 시도가 없는 대기는 실패 예산을 소모하지 않는다', async () => {
        const calls: Array<{ sql: string; params: unknown[] }> = [];
        const execute = vi.fn(async (sql: string, params: unknown[] = []) => {
            calls.push({ sql, params });
            if (sql.includes('SELECT id, provider, provider_event_id')) {
                return [{ id: '300', provider: 'demo-pay', provider_event_id: 'missing-attempt', retry_count: 0 }];
            }
            return { affectedRows: 1 };
        });
        const orm = {
            em: {
                fork: vi.fn(() => ({
                    execute,
                    transactional: async (work: (tx: { execute: typeof execute }) => Promise<unknown>) =>
                        work({ execute }),
                })),
            },
        } as never;
        const paymentService = {
            recoverStoredWebhook: vi.fn(async () => ({
                disposition: 'RETRY' as const,
                errorMessage: 'Webhook 대상 결제 시도를 아직 찾을 수 없습니다.',
            })),
        } as never;
        const relay = new PaymentWebhookRecoveryRelay(orm, paymentService);

        await expect(relay.drainBatch(1)).resolves.toEqual({ claimed: 1, processed: 0, retried: 1, failed: 0 });
        const claimUpdate = calls.find(({ sql }) => sql.includes('lease_until ='));
        const retryUpdate = calls.find(({ sql }) => sql.includes('retry_count = ?'));
        expect(claimUpdate?.sql).toContain('DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL ? MICROSECOND)');
        expect(claimUpdate?.params.slice(0, 2)).toEqual([expect.any(String), 30_000_000]);
        expect(retryUpdate?.sql).toContain('DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL ? MICROSECOND)');
        expect(retryUpdate?.params.slice(0, 3)).toEqual(['RECEIVED', 0, 60_000_000]);
        expect(calls[0]?.sql).toContain('outcome IS NOT NULL');
    });
});

function createPaymentService(
    overrides: {
        readonly findWebhook?: (where: Record<string, unknown>) => Promise<PaymentWebhookEventEntity | null>;
        readonly findAttempt?: (where: Record<string, unknown>) => Promise<PaymentAttemptEntity | null>;
        readonly persist?: (entity: object) => void;
    } = {}
) {
    const persist = vi.fn(overrides.persist ?? (() => undefined));
    const entityManager = Object.assign(Object.create(EntityManager.prototype), { persist }) as EntityManager;
    entityManager.lock = vi.fn(async () => undefined) as unknown as EntityManager['lock'];
    entityManager.transactional = vi.fn(async (work: (em: EntityManager) => Promise<unknown>) =>
        work(entityManager)
    ) as unknown as EntityManager['transactional'];
    const requestContextSource = { name: 'default', fork: vi.fn(() => entityManager) } as unknown as EntityManager;
    const service = new PaymentService(
        entityManager,
        { findOne: vi.fn(async () => null) } as unknown as EntityRepository<OrderEntity>,
        {
            findOne: overrides.findAttempt ?? vi.fn(async () => null),
        } as unknown as EntityRepository<PaymentAttemptEntity>,
        { findOne: vi.fn(async () => null) } as unknown as EntityRepository<PaymentTransactionEntity>,
        {
            findOne: overrides.findWebhook ?? vi.fn(async () => null),
        } as unknown as EntityRepository<PaymentWebhookEventEntity>,
        { consumeForPayment: vi.fn() } as unknown as PaymentInventoryPort
    );
    return { service, persist, requestContextSource };
}

function inRequestContext<T>(entityManager: EntityManager, work: () => Promise<T>): Promise<T> {
    return RequestContext.create(entityManager, work);
}
