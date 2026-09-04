import type { PaymentResult, PaymentWebhookResult } from '~/api/payment/application/payment.service';
import type { PaymentTransactionEntity } from '~/api/payment/domain/payment-transaction.entity';
import type {
    PaymentPayload,
    PaymentTransactionRecordType,
    PaymentWebhookPayload,
} from '~/api/payment/presentation/payment.type';

export function toPaymentPayload({ attempt, transaction }: PaymentResult): PaymentPayload {
    if (attempt.id == null) throw new Error('저장되지 않은 결제 시도입니다.');

    return {
        payment: {
            id: attempt.id.toString(),
            orderId: attempt.order.id.toString(),
            provider: attempt.provider,
            method: attempt.method,
            status: attempt.status,
            requestedAmount: { amount: attempt.requestedAmount, currencyCode: attempt.currencyCode },
            providerPaymentId: attempt.providerPaymentId,
            errorCode: attempt.errorCode,
            errorMessage: attempt.errorMessage,
            capturedAt: attempt.capturedAt,
            transactions: attempt.transactions.getItems().map((item) => toTransactionType(item, attempt.currencyCode)),
        },
        transaction: transaction ? toTransactionType(transaction, attempt.currencyCode) : null,
    };
}

export function toPaymentWebhookPayload({ event, transaction }: PaymentWebhookResult): PaymentWebhookPayload {
    if (event.id == null) throw new Error('저장되지 않은 Webhook 이벤트입니다.');

    return {
        event: {
            id: event.id.toString(),
            provider: event.provider,
            providerEventId: event.providerEventId,
            status: event.status,
            paymentAttemptId: event.paymentAttempt?.id.toString() ?? null,
            receivedAt: event.receivedAt,
            processedAt: event.processedAt,
            errorMessage: event.errorMessage,
        },
        transaction: transaction ? toTransactionType(transaction, transaction.paymentAttempt.currencyCode) : null,
    };
}

function toTransactionType(transaction: PaymentTransactionEntity, currencyCode: string): PaymentTransactionRecordType {
    if (transaction.id == null) throw new Error('저장되지 않은 결제 거래입니다.');

    return {
        id: transaction.id.toString(),
        type: transaction.type,
        status: transaction.status,
        amount: { amount: transaction.amount, currencyCode },
        providerTransactionId: transaction.providerTransactionId,
        errorCode: transaction.errorCode,
        errorMessage: transaction.errorMessage,
        processedAt: transaction.processedAt,
    };
}
