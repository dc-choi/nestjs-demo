import { Collection, type Opt, type Rel } from '@mikro-orm/core';
import { Entity, Enum, Index, ManyToOne, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy';

import { PaymentAttemptEntity } from '~/api/payment/domain/payment-attempt.entity';
import { PaymentTransactionStatus, PaymentTransactionType } from '~/api/payment/domain/payment.enum';

/**
 * 승인, 매입, 환불, 승인 취소 같은 provider 작업을 각각 별도 행으로 누적한다.
 * attempt 내부의 멱등성 키와 provider 거래 ID가 동일 작업의 중복 반영을 막는다.
 * 누적 매입과 환불 금액 한도는 애플리케이션이 검증한다.
 */
@Entity({ tableName: 'payment_transactions' })
@Unique({
    name: 'payment_transactions_payment_attempt_id_idempotency_key_key',
    properties: ['paymentAttempt', 'idempotencyKey'],
})
@Unique({
    name: 'payment_transactions_payment_attempt_id_provider_transaction_key',
    properties: ['paymentAttempt', 'providerTransactionId'],
})
@Index({
    name: 'payment_transactions_payment_attempt_id_status_idx',
    properties: ['paymentAttempt', 'status'],
})
export class PaymentTransactionEntity {
    static succeed({
        paymentAttempt,
        type,
        amount,
        idempotencyKey,
        providerTransactionId,
        processedAt = new Date(),
    }: {
        readonly paymentAttempt: Rel<PaymentAttemptEntity>;
        readonly type: PaymentTransactionType;
        readonly amount: string;
        readonly idempotencyKey: string;
        readonly providerTransactionId: string;
        readonly processedAt?: Date;
    }): PaymentTransactionEntity {
        if (providerTransactionId.trim().length === 0 || providerTransactionId.length > 255) {
            throw new RangeError('결제 제공자 거래 ID가 올바르지 않습니다.');
        }
        const transaction = PaymentTransactionEntity.create(paymentAttempt, type, amount, idempotencyKey);

        transaction.status = PaymentTransactionStatus.SUCCEEDED;
        transaction.providerTransactionId = providerTransactionId;
        transaction.processedAt = processedAt;
        return transaction;
    }

    static fail({
        paymentAttempt,
        type,
        amount,
        idempotencyKey,
        errorCode,
        errorMessage = null,
        processedAt = new Date(),
    }: {
        readonly paymentAttempt: Rel<PaymentAttemptEntity>;
        readonly type: PaymentTransactionType;
        readonly amount: string;
        readonly idempotencyKey: string;
        readonly errorCode: string;
        readonly errorMessage?: string | null;
        readonly processedAt?: Date;
    }): PaymentTransactionEntity {
        if (errorCode.trim().length === 0 || errorCode.length > 128) {
            throw new RangeError('결제 실패 코드가 올바르지 않습니다.');
        }
        const transaction = PaymentTransactionEntity.create(paymentAttempt, type, amount, idempotencyKey);
        transaction.status = PaymentTransactionStatus.FAILED;
        transaction.errorCode = errorCode;
        transaction.errorMessage = errorMessage;
        transaction.processedAt = processedAt;
        return transaction;
    }

    private static create(
        paymentAttempt: Rel<PaymentAttemptEntity>,
        type: PaymentTransactionType,
        amount: string,
        idempotencyKey: string
    ): PaymentTransactionEntity {
        if (idempotencyKey.trim().length === 0 || idempotencyKey.length > 128) {
            throw new RangeError('결제 거래 멱등성 키는 1자 이상 128자 이하여야 합니다.');
        }

        const transaction = new PaymentTransactionEntity();
        transaction.paymentAttempt = paymentAttempt;
        transaction.type = type;
        transaction.amount = amount;
        transaction.idempotencyKey = idempotencyKey;
        paymentAttempt.transactions = new Collection(paymentAttempt, [
            ...paymentAttempt.transactions.getItems(),
            transaction,
        ]);

        return transaction;
    }

    @PrimaryKey({ type: 'bigint', autoincrement: true, unsigned: false })
    id!: bigint;

    @Enum({ items: () => PaymentTransactionType })
    type!: PaymentTransactionType;

    @Enum({ items: () => PaymentTransactionStatus, default: PaymentTransactionStatus.PENDING })
    status: PaymentTransactionStatus & Opt = PaymentTransactionStatus.PENDING;

    @Property({ type: 'decimal', precision: 19, scale: 3 })
    amount!: string;

    /** 같은 PaymentAttempt 안에서 작업 요청의 재실행을 식별한다. */
    @Property({ fieldName: 'idempotency_key', columnType: 'varchar(128)' })
    idempotencyKey!: string;

    /** provider 작업 식별자이며 같은 PaymentAttempt 안에서 유일하다. */
    @Property({ fieldName: 'provider_transaction_id', columnType: 'varchar(255)', nullable: true })
    providerTransactionId: string | null = null;

    @Property({ fieldName: 'error_code', columnType: 'varchar(128)', nullable: true })
    errorCode: string | null = null;

    @Property({ fieldName: 'error_message', columnType: 'text', nullable: true })
    errorMessage: string | null = null;

    @Property({ fieldName: 'processed_at', columnType: 'datetime(3)', nullable: true })
    processedAt: Date | null = null;

    @Property({ fieldName: 'created_at', columnType: 'datetime(3)', defaultRaw: 'CURRENT_TIMESTAMP(3)' })
    createdAt!: Date & Opt;

    @ManyToOne(() => PaymentAttemptEntity, {
        joinColumn: 'payment_attempt_id',
        inversedBy: 'transactions',
        deleteRule: 'restrict',
        updateRule: 'cascade',
        foreignKeyName: 'payment_transactions_payment_attempt_id_fkey',
        unsigned: false,
        index: false,
    })
    paymentAttempt!: Rel<PaymentAttemptEntity>;
}
