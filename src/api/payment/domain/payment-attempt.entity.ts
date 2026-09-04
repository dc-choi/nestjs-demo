import { Collection, type Opt, type Rel } from '@mikro-orm/core';
import { Entity, Enum, Index, ManyToOne, OneToMany, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy';

import { OrderEntity } from '~/api/order/domain/entity/order.entity';
import { PaymentTransactionEntity } from '~/api/payment/domain/payment-transaction.entity';
import { PaymentWebhookEventEntity } from '~/api/payment/domain/payment-webhook-event.entity';
import { PaymentAttemptStatus } from '~/api/payment/domain/payment.enum';

const CAPTURABLE_STATUSES: readonly PaymentAttemptStatus[] = [
    PaymentAttemptStatus.PENDING,
    PaymentAttemptStatus.AUTHORIZED,
];
const FAILABLE_STATUSES: readonly PaymentAttemptStatus[] = [
    PaymentAttemptStatus.PENDING,
    PaymentAttemptStatus.REQUIRES_ACTION,
    PaymentAttemptStatus.AUTHORIZED,
];
const REFUNDABLE_STATUSES: readonly PaymentAttemptStatus[] = [
    PaymentAttemptStatus.CAPTURED,
    PaymentAttemptStatus.PARTIALLY_REFUNDED,
    PaymentAttemptStatus.REFUNDED,
];
const CANCELLABLE_STATUSES: readonly PaymentAttemptStatus[] = [
    PaymentAttemptStatus.PENDING,
    PaymentAttemptStatus.REQUIRES_ACTION,
];

/**
 * 한 주문에 대해 결제 제공자에게 시도한 결제 수명 주기의 현재 요약이다.
 * 재시도는 별도 attempt로 남기고 승인, 매입, 환불 작업은 transaction으로 누적한다.
 * webhook은 도착 순서에 따라 나중에 선택적으로 연결될 수 있다.
 */
@Entity({ tableName: 'payment_attempts' })
@Unique({
    name: 'payment_attempts_provider_idempotency_key_key',
    properties: ['provider', 'idempotencyKey'],
})
@Unique({
    name: 'payment_attempts_provider_provider_payment_id_key',
    properties: ['provider', 'providerPaymentId'],
})
@Index({ name: 'payment_attempts_order_id_status_idx', properties: ['order', 'status'] })
export class PaymentAttemptEntity {
    static create({
        order,
        provider,
        method = null,
        idempotencyKey,
        providerPaymentId = null,
    }: {
        readonly order: Rel<OrderEntity>;
        readonly provider: string;
        readonly method?: string | null;
        readonly idempotencyKey: string;
        readonly providerPaymentId?: string | null;
    }): PaymentAttemptEntity {
        if (provider.trim().length === 0 || provider.length > 64)
            throw new RangeError('결제 제공자 값이 올바르지 않습니다.');
        if (idempotencyKey.trim().length === 0 || idempotencyKey.length > 128) {
            throw new RangeError('결제 멱등성 키는 1자 이상 128자 이하여야 합니다.');
        }
        if (method != null && (method.trim().length === 0 || method.length > 64)) {
            throw new RangeError('결제 수단 값이 올바르지 않습니다.');
        }
        if (providerPaymentId != null && (providerPaymentId.trim().length === 0 || providerPaymentId.length > 255)) {
            throw new RangeError('결제 제공자 결제 ID가 올바르지 않습니다.');
        }

        const attempt = new PaymentAttemptEntity();
        attempt.order = order;
        attempt.provider = provider;
        attempt.method = method;
        attempt.requestedAmount = order.totalPrice;
        attempt.currencyCode = order.currencyCode;
        attempt.idempotencyKey = idempotencyKey;
        attempt.providerPaymentId = providerPaymentId;
        if (order.paymentAttempts.isInitialized()) {
            order.paymentAttempts = new Collection(order, [...order.paymentAttempts.getItems(), attempt]);
        }

        return attempt;
    }

    capture(processedAt = new Date()): void {
        if (this.status === PaymentAttemptStatus.CAPTURED) return;
        if (!CAPTURABLE_STATUSES.includes(this.status)) {
            throw new Error(`${this.status} 결제 시도는 매입할 수 없습니다.`);
        }

        this.status = PaymentAttemptStatus.CAPTURED;
        this.authorizedAt ??= processedAt;
        this.capturedAt = processedAt;
        this.errorCode = null;
        this.errorMessage = null;
    }

    fail(errorCode: string, errorMessage: string | null): void {
        if (this.status === PaymentAttemptStatus.FAILED) return;
        if (!FAILABLE_STATUSES.includes(this.status)) {
            throw new Error(`${this.status} 결제 시도는 실패 처리할 수 없습니다.`);
        }
        if (errorCode.trim().length === 0 || errorCode.length > 128) {
            throw new RangeError('결제 실패 코드가 올바르지 않습니다.');
        }

        this.status = PaymentAttemptStatus.FAILED;
        this.errorCode = errorCode;
        this.errorMessage = errorMessage;
    }

    refund(fullyRefunded: boolean): void {
        if (!REFUNDABLE_STATUSES.includes(this.status)) {
            throw new Error(`${this.status} 결제 시도는 환불할 수 없습니다.`);
        }
        if (this.status === PaymentAttemptStatus.REFUNDED && !fullyRefunded) {
            throw new Error('전액 환불된 결제를 부분 환불 상태로 되돌릴 수 없습니다.');
        }

        this.status = fullyRefunded ? PaymentAttemptStatus.REFUNDED : PaymentAttemptStatus.PARTIALLY_REFUNDED;
    }

    cancel(now = new Date()): boolean {
        if (this.status === PaymentAttemptStatus.CANCELLED) return false;
        if (!CANCELLABLE_STATUSES.includes(this.status)) {
            throw new Error(`${this.status} 결제 시도는 취소할 수 없습니다.`);
        }

        this.status = PaymentAttemptStatus.CANCELLED;
        this.cancelledAt = now;
        return true;
    }

    @PrimaryKey({ type: 'bigint', autoincrement: true, unsigned: false })
    id!: bigint;

    @Property({ columnType: 'varchar(64)' })
    provider!: string;

    @Property({ columnType: 'varchar(64)', nullable: true })
    method: string | null = null;

    /** 개별 transaction 결과를 반영한 시도의 현재 요약이며 상태별 시각과 함께 갱신한다. */
    @Enum({ items: () => PaymentAttemptStatus, default: PaymentAttemptStatus.PENDING })
    status: PaymentAttemptStatus & Opt = PaymentAttemptStatus.PENDING;

    @Property({ fieldName: 'requested_amount', type: 'decimal', precision: 19, scale: 3 })
    requestedAmount!: string;

    @Property({ fieldName: 'currency_code', columnType: 'char(3)' })
    currencyCode!: string;

    /** provider 범위에서 같은 외부 결제 생성 요청의 재실행을 식별한다. */
    @Property({ fieldName: 'idempotency_key', columnType: 'varchar(128)' })
    idempotencyKey!: string;

    /** provider가 발급한 결제 식별자이며 provider 범위에서 유일하다. */
    @Property({ fieldName: 'provider_payment_id', columnType: 'varchar(255)', nullable: true })
    providerPaymentId: string | null = null;

    @Property({ fieldName: 'error_code', columnType: 'varchar(128)', nullable: true })
    errorCode: string | null = null;

    @Property({ fieldName: 'error_message', columnType: 'text', nullable: true })
    errorMessage: string | null = null;

    @Property({ fieldName: 'authorized_at', columnType: 'datetime(3)', nullable: true })
    authorizedAt: Date | null = null;

    @Property({ fieldName: 'captured_at', columnType: 'datetime(3)', nullable: true })
    capturedAt: Date | null = null;

    @Property({ fieldName: 'cancelled_at', columnType: 'datetime(3)', nullable: true })
    cancelledAt: Date | null = null;

    @Property({ fieldName: 'created_at', columnType: 'datetime(3)', defaultRaw: 'CURRENT_TIMESTAMP(3)' })
    createdAt!: Date & Opt;

    @Property({
        fieldName: 'updated_at',
        columnType: 'datetime(3)',
        defaultRaw: 'CURRENT_TIMESTAMP(3)',
        onUpdate: () => new Date(),
    })
    updatedAt!: Date & Opt;

    @ManyToOne(() => OrderEntity, {
        joinColumn: 'order_id',
        inversedBy: 'paymentAttempts',
        deleteRule: 'restrict',
        updateRule: 'cascade',
        foreignKeyName: 'payment_attempts_order_id_fkey',
        unsigned: false,
        index: false,
    })
    order!: Rel<OrderEntity>;

    @OneToMany(() => PaymentTransactionEntity, (transaction) => transaction.paymentAttempt)
    transactions = new Collection<PaymentTransactionEntity>(this);

    @OneToMany(() => PaymentWebhookEventEntity, (event) => event.paymentAttempt)
    webhookEvents = new Collection<PaymentWebhookEventEntity>(this);
}
