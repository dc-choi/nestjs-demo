import { Collection, type Opt, type Rel } from '@mikro-orm/core';
import { Entity, Enum, Index, ManyToOne, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy';

import { PaymentAttemptEntity } from '~/api/payment/domain/payment-attempt.entity';
import { PaymentWebhookEventStatus } from '~/api/payment/domain/payment.enum';

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
export class PaymentWebhookEventEntity {
    static receive({
        provider,
        providerEventId,
        payloadHash,
        paymentAttempt = null,
        receivedAt = new Date(),
    }: {
        readonly provider: string;
        readonly providerEventId: string;
        readonly payloadHash: string;
        readonly paymentAttempt?: Rel<PaymentAttemptEntity> | null;
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
        if (paymentAttempt?.webhookEvents.isInitialized()) {
            paymentAttempt.webhookEvents = new Collection(paymentAttempt, [
                ...paymentAttempt.webhookEvents.getItems(),
                event,
            ]);
        }

        return event;
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

    @Enum({ items: () => PaymentWebhookEventStatus, default: PaymentWebhookEventStatus.RECEIVED })
    status: PaymentWebhookEventStatus & Opt = PaymentWebhookEventStatus.RECEIVED;

    @Property({ fieldName: 'received_at', columnType: 'datetime(3)', defaultRaw: 'CURRENT_TIMESTAMP(3)' })
    receivedAt!: Date & Opt;

    @Property({ fieldName: 'processed_at', columnType: 'datetime(3)', nullable: true })
    processedAt: Date | null = null;

    @Property({ fieldName: 'error_message', columnType: 'text', nullable: true })
    errorMessage: string | null = null;

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
