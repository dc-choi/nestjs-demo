import type { PaymentAttemptEntity } from '~/api/payment/domain/payment-attempt.entity';
import type { PaymentTransactionEntity } from '~/api/payment/domain/payment-transaction.entity';
import type { PaymentWebhookEventEntity } from '~/api/payment/domain/payment-webhook-event.entity';

export interface PaymentResult {
    readonly attempt: PaymentAttemptEntity;
    readonly transaction: PaymentTransactionEntity | null;
}

export interface PaymentWebhookResult {
    readonly event: PaymentWebhookEventEntity;
    readonly transaction: PaymentTransactionEntity | null;
}

export type PaymentWebhookRecoveryDisposition = 'PROCESSED' | 'RETRY' | 'FAILED';

export interface PaymentWebhookRecoveryResult {
    readonly disposition: PaymentWebhookRecoveryDisposition;
    readonly errorMessage: string | null;
}
