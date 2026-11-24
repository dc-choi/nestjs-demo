import type { PaymentAttemptEntity } from '~/api/payment/domain/entity/payment-attempt.entity.js';
import type { PaymentTransactionEntity } from '~/api/payment/domain/entity/payment-transaction.entity.js';
import type { PaymentWebhookEventEntity } from '~/api/payment/domain/entity/payment-webhook-event.entity.js';

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
