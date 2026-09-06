import { PaymentWebhookOutcome } from '~/api/payment/domain/payment.enum';

export { PaymentWebhookOutcome } from '~/api/payment/domain/payment.enum';

export interface CreatePaymentAttemptCommand {
    readonly orderId: bigint;
    readonly provider: string;
    readonly method?: string | null;
    readonly idempotencyKey: string;
    readonly providerPaymentId?: string | null;
}

export interface CapturePaymentCommand {
    readonly paymentAttemptId: bigint;
    readonly idempotencyKey: string;
    readonly providerTransactionId: string;
}

export interface FailPaymentCommand {
    readonly paymentAttemptId: bigint;
    readonly idempotencyKey: string;
    readonly errorCode: string;
    readonly errorMessage?: string | null;
}

export interface RefundPaymentCommand {
    readonly paymentAttemptId: bigint;
    readonly amount: string;
    readonly idempotencyKey: string;
    readonly providerTransactionId: string;
}

export interface ReceivePaymentWebhookCommand {
    readonly provider: string;
    readonly providerEventId: string;
    readonly providerPaymentId?: string | null;
    readonly payloadHash: string;
}

export interface ProcessPaymentWebhookCommand extends ReceivePaymentWebhookCommand {
    readonly outcome: PaymentWebhookOutcome;
    readonly providerTransactionId?: string | null;
    readonly amount?: string | null;
    readonly errorCode?: string | null;
    readonly errorMessage?: string | null;
}

/** A command persisted only after a provider signature has been verified. */
export type VerifiedPaymentWebhookCommand = ProcessPaymentWebhookCommand;
