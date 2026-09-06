import { Collection, type Opt, type Rel } from '@mikro-orm/core';
import { Entity, Enum, Index, ManyToOne, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy';

import { PaymentAttemptEntity } from '~/api/payment/domain/payment-attempt.entity';
import { PaymentWebhookEventStatus, PaymentWebhookOutcome } from '~/api/payment/domain/payment.enum';

/**
 * provider webhook의 중복 수신과 처리 결과를 추적하는 inbox 기록이다.
 * 이벤트가 결제 시도보다 먼저 도착할 수 있어 연결은 선택적이며 순서와 무관하게 멱등 처리한다.
 * 비밀이나 개인정보가 포함될 수 있는 원문은 저장하지 않고 hash만 보존한다.
 */
@Entity({ tableName: 'payment_webhook_events' })
@Unique({
    name: 'payment_webhook_events_provider_provider_event_id_key',
    properties: ['provider', 'providerEventId'],
})
@Index({ name: 'payment_webhook_events_status_received_at_idx', properties: ['status', 'receivedAt'] })
@Index({ name: 'payment_webhook_events_recovery_idx', properties: ['status', 'outcome', 'nextRetryAt', 'leaseUntil'] })
export class PaymentWebhookEventEntity {
    static receive({
        provider,
        providerEventId,
        payloadHash,
        paymentAttempt = null,
        verifiedCommand = null,
        receivedAt = new Date(),
    }: {
        readonly provider: string;
        readonly providerEventId: string;
        readonly payloadHash: string;
        readonly paymentAttempt?: Rel<PaymentAttemptEntity> | null;
        readonly verifiedCommand?: {
            readonly providerPaymentId?: string | null;
            readonly outcome: PaymentWebhookOutcome;
            readonly providerTransactionId?: string | null;
            readonly amount?: string | null;
            readonly errorCode?: string | null;
            readonly errorMessage?: string | null;
        } | null;
        readonly receivedAt?: Date;
    }): PaymentWebhookEventEntity {
        if (provider.trim().length === 0 || provider.length > 64)
            throw new RangeError('결제 제공자 값이 올바르지 않습니다.');
        if (providerEventId.trim().length === 0 || providerEventId.length > 255) {
            throw new RangeError('Webhook 이벤트 ID가 올바르지 않습니다.');
        }
        if (!/^[a-f\d]{64}$/i.test(payloadHash)) throw new TypeError('Webhook payload hash가 올바르지 않습니다.');

        const event = new PaymentWebhookEventEntity();
        event.provider = provider;
        event.providerEventId = providerEventId;
        event.payloadHash = payloadHash.toLowerCase();
        event.paymentAttempt = paymentAttempt;
        event.receivedAt = receivedAt;
        if (verifiedCommand) event.storeVerifiedCommand(verifiedCommand);
        if (paymentAttempt?.webhookEvents.isInitialized()) {
            paymentAttempt.webhookEvents = new Collection(paymentAttempt, [
                ...paymentAttempt.webhookEvents.getItems(),
                event,
            ]);
        }

        return event;
    }

    storeVerifiedCommand(
        command: {
            readonly providerPaymentId?: string | null;
            readonly outcome: PaymentWebhookOutcome;
            readonly providerTransactionId?: string | null;
            readonly amount?: string | null;
            readonly errorCode?: string | null;
            readonly errorMessage?: string | null;
        },
        now = new Date()
    ): void {
        if (this.outcome) throw new Error('검증된 Webhook 명령은 변경할 수 없습니다.');
        this.providerPaymentId = command.providerPaymentId ?? null;
        this.outcome = command.outcome;
        this.providerTransactionId = command.providerTransactionId ?? null;
        this.amount = command.amount ?? null;
        this.failureErrorCode = command.errorCode ?? null;
        this.failureErrorMessage = command.errorMessage?.slice(0, 1_000) ?? null;

        // Legacy failures become recoverable only when their first verified command is supplied.
        if (this.status !== PaymentWebhookEventStatus.FAILED) return;
        this.status = PaymentWebhookEventStatus.RECEIVED;
        this.processedAt = null;
        this.errorMessage = null;
        this.retryCount = 0;
        this.nextRetryAt = now;
        this.leaseToken = null;
        this.leaseUntil = null;
    }

    verifiedCommand(): {
        provider: string;
        providerEventId: string;
        providerPaymentId?: string | null;
        payloadHash: string;
        outcome: PaymentWebhookOutcome;
        providerTransactionId?: string | null;
        amount?: string | null;
        errorCode?: string | null;
        errorMessage?: string | null;
    } | null {
        if (!this.outcome) return null;
        return {
            provider: this.provider,
            providerEventId: this.providerEventId,
            providerPaymentId: this.providerPaymentId,
            payloadHash: this.payloadHash,
            outcome: this.outcome,
            providerTransactionId: this.providerTransactionId,
            amount: this.amount,
            errorCode: this.failureErrorCode,
            errorMessage: this.failureErrorMessage,
        };
    }

    processed(paymentAttempt: Rel<PaymentAttemptEntity>, processedAt = new Date()): void {
        if (this.status === PaymentWebhookEventStatus.PROCESSED) return;
        this.paymentAttempt = paymentAttempt;
        this.status = PaymentWebhookEventStatus.PROCESSED;
        this.processedAt = processedAt;
        this.errorMessage = null;
        if (paymentAttempt.webhookEvents.isInitialized() && !paymentAttempt.webhookEvents.contains(this)) {
            paymentAttempt.webhookEvents = new Collection(paymentAttempt, [
                ...paymentAttempt.webhookEvents.getItems(),
                this,
            ]);
        }
    }

    failed(errorMessage: string, processedAt = new Date()): void {
        if (this.status === PaymentWebhookEventStatus.PROCESSED) {
            throw new Error('처리 완료된 Webhook 이벤트는 실패 처리할 수 없습니다.');
        }
        this.status = PaymentWebhookEventStatus.FAILED;
        this.processedAt = processedAt;
        this.errorMessage = errorMessage;
    }

    @PrimaryKey({ type: 'bigint', autoincrement: true, unsigned: false })
    id!: bigint;

    @Property({ columnType: 'varchar(64)' })
    provider!: string;

    /** provider 범위에서 중복 이벤트 수신을 식별한다. */
    @Property({ fieldName: 'provider_event_id', columnType: 'varchar(255)' })
    providerEventId!: string;

    /** 원문 없이 payload 동일성을 비교하는 값이며 webhook 서명 검증을 대신하지 않는다. */
    @Property({ fieldName: 'payload_hash', columnType: 'char(64)' })
    payloadHash!: string;

    /** Signed, normalized command fields are retained for durable out-of-order recovery. */
    @Property({ fieldName: 'provider_payment_id', columnType: 'varchar(255)', nullable: true })
    providerPaymentId: string | null = null;

    @Property({ columnType: 'varchar(16)', nullable: true })
    outcome: PaymentWebhookOutcome | null = null;

    @Property({ fieldName: 'provider_transaction_id', columnType: 'varchar(255)', nullable: true })
    providerTransactionId: string | null = null;

    @Property({ columnType: 'varchar(32)', nullable: true })
    amount: string | null = null;

    @Property({ fieldName: 'failure_error_code', columnType: 'varchar(128)', nullable: true })
    failureErrorCode: string | null = null;

    @Property({ fieldName: 'failure_error_message', columnType: 'varchar(1000)', nullable: true })
    failureErrorMessage: string | null = null;

    @Enum({ items: () => PaymentWebhookEventStatus, default: PaymentWebhookEventStatus.RECEIVED })
    status: PaymentWebhookEventStatus & Opt = PaymentWebhookEventStatus.RECEIVED;

    @Property({ fieldName: 'received_at', columnType: 'datetime(3)', defaultRaw: 'CURRENT_TIMESTAMP(3)' })
    receivedAt!: Date & Opt;

    @Property({ fieldName: 'processed_at', columnType: 'datetime(3)', nullable: true })
    processedAt: Date | null = null;

    @Property({ fieldName: 'error_message', columnType: 'text', nullable: true })
    errorMessage: string | null = null;

    @Property({ fieldName: 'retry_count', type: 'integer', unsigned: true, default: 0 })
    retryCount: number & Opt = 0;

    @Property({ fieldName: 'next_retry_at', columnType: 'datetime(3)', defaultRaw: 'CURRENT_TIMESTAMP(3)' })
    nextRetryAt!: Date & Opt;

    @Property({ fieldName: 'lease_token', columnType: 'char(36)', nullable: true })
    leaseToken: string | null = null;

    @Property({ fieldName: 'lease_until', columnType: 'datetime(3)', nullable: true })
    leaseUntil: Date | null = null;

    /** webhook 선도착을 허용하기 위해 처리 대상 attempt가 확인되기 전에는 null일 수 있다. */
    @ManyToOne(() => PaymentAttemptEntity, {
        joinColumn: 'payment_attempt_id',
        inversedBy: 'webhookEvents',
        nullable: true,
        deleteRule: 'set null',
        updateRule: 'cascade',
        foreignKeyName: 'payment_webhook_events_payment_attempt_id_fkey',
        unsigned: false,
        index: 'payment_webhook_events_payment_attempt_id_fkey',
    })
    paymentAttempt: Rel<PaymentAttemptEntity> | null = null;
}
