import { Collection, type Opt, type Rel } from '@mikro-orm/core';
import { Entity, Enum, Index, ManyToOne, OneToMany, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy';

import { OrderEntity } from '~/api/order/domain/entity/order.entity.js';
import { PaymentAttemptStatus } from '~/api/payment/domain/entity/payment-attempt-status.js';
import { PaymentTransactionStatus } from '~/api/payment/domain/entity/payment-transaction-status.js';
import { PaymentTransactionType } from '~/api/payment/domain/entity/payment-transaction-type.js';
import { PaymentTransactionEntity } from '~/api/payment/domain/entity/payment-transaction.entity.js';
import { PaymentWebhookEventEntity } from '~/api/payment/domain/entity/payment-webhook-event.entity.js';
import { PaymentAttemptConflict } from '~/api/payment/domain/payment-attempt-conflict.error.js';
import { compareMoney, sumMoney } from '~/api/payment/domain/payment-money.js';

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

    /** 상태를 바꾸지 않고 매입 가능 여부를 검사한다. Service가 다른 aggregate 검사보다 먼저 부른다. */
    assertCapturable(): void {
        if (!this.isCapturable()) {
            throw new PaymentAttemptConflict(`${this.status} 결제 시도는 매입할 수 없습니다.`);
        }
    }

    /** 같은 요청의 재실행은 Service가 거래 원장으로 판정하므로, 이미 매입한 시도의 새 매입은 거절한다. */
    capture(processedAt = new Date()): void {
        this.assertCapturable();

        this.status = PaymentAttemptStatus.CAPTURED;
        this.authorizedAt ??= processedAt;
        this.capturedAt = processedAt;
        this.errorCode = null;
        this.errorMessage = null;
    }

    /** 이미 실패한 시도를 조용히 넘기면 새 요청이 실패 거래를 중복 기록하므로 거절한다. */
    fail(errorCode: string, errorMessage: string | null): void {
        if (this.status === PaymentAttemptStatus.FAILED) {
            throw new PaymentAttemptConflict('이미 다른 요청으로 실패 처리된 결제입니다.');
        }
        if (!this.isFailable()) {
            throw new PaymentAttemptConflict(`${this.status} 결제 시도는 실패 처리할 수 없습니다.`);
        }
        if (errorCode.trim().length === 0 || errorCode.length > 128) {
            throw new RangeError('결제 실패 코드가 올바르지 않습니다.');
        }

        this.status = PaymentAttemptStatus.FAILED;
        this.errorCode = errorCode;
        this.errorMessage = errorMessage;
    }

    /**
     * `amount`를 새로 환불할 수 있는지 누적 한도로 검증하고, 남은 매입액을 모두 환불하는지 돌려준다.
     * 상태를 바꾸지 않으므로 Service가 다른 aggregate 조건을 확인한 뒤 `refund()`를 호출할 수 있다.
     */
    isFullRefund(amount: string): boolean {
        if (!this.isRefundable()) {
            throw new PaymentAttemptConflict(`${this.status} 결제 시도는 환불할 수 없습니다.`);
        }
        const { captured, refunded } = this.settledAmounts();
        const comparison = compareMoney(sumMoney([refunded, amount]), captured);
        if (comparison > 0) throw new RangeError('환불 누적 금액은 매입 금액을 초과할 수 없습니다.');
        if (comparison < 0 && this.status === PaymentAttemptStatus.REFUNDED) {
            throw new PaymentAttemptConflict('전액 환불된 결제를 부분 환불 상태로 되돌릴 수 없습니다.');
        }
        return comparison === 0;
    }

    /** 환불 거래 원장은 호출자가 이 호출 뒤에 기록한다. */
    refund(amount: string): void {
        this.status = this.isFullRefund(amount)
            ? PaymentAttemptStatus.REFUNDED
            : PaymentAttemptStatus.PARTIALLY_REFUNDED;
    }

    cancel(now = new Date()): boolean {
        if (this.status === PaymentAttemptStatus.CANCELLED) return false;
        if (!this.isCancellable()) {
            throw new PaymentAttemptConflict(`${this.status} 결제 시도는 취소할 수 없습니다.`);
        }

        this.status = PaymentAttemptStatus.CANCELLED;
        this.cancelledAt = now;
        return true;
    }

    isCapturable(): boolean {
        return CAPTURABLE_STATUSES.includes(this.status);
    }

    isFailable(): boolean {
        return FAILABLE_STATUSES.includes(this.status);
    }

    isRefundable(): boolean {
        return REFUNDABLE_STATUSES.includes(this.status);
    }

    isCancellable(): boolean {
        return CANCELLABLE_STATUSES.includes(this.status);
    }

    isTerminalForReservationExpiration(): boolean {
        return this.status === PaymentAttemptStatus.CANCELLED || this.status === PaymentAttemptStatus.FAILED;
    }

    requiresCancellationBeforeOrderCancellation(): boolean {
        return this.status === PaymentAttemptStatus.AUTHORIZED;
    }

    isFunded(): boolean {
        return this.status === PaymentAttemptStatus.CAPTURED || this.status === PaymentAttemptStatus.PARTIALLY_REFUNDED;
    }

    hasUnrefundedCapture(): boolean {
        if (this.status === PaymentAttemptStatus.CAPTURED || this.status === PaymentAttemptStatus.PARTIALLY_REFUNDED) {
            return true;
        }

        const { captured, refunded } = this.settledAmounts();
        return compareMoney(captured, refunded) > 0;
    }

    /** 성공한 CAPTURE와 REFUND 거래의 누적 금액이다. */
    private settledAmounts(): { readonly captured: string; readonly refunded: string } {
        const succeeded = this.transactions
            .getItems()
            .filter(({ status }) => status === PaymentTransactionStatus.SUCCEEDED);
        const total = (type: PaymentTransactionType) =>
            sumMoney(succeeded.filter((transaction) => transaction.type === type).map(({ amount }) => amount));
        return { captured: total(PaymentTransactionType.CAPTURE), refunded: total(PaymentTransactionType.REFUND) };
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
