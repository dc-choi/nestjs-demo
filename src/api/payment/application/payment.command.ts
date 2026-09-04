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

export const PaymentWebhookOutcome = {
    CAPTURED: 'CAPTURED',
    FAILED: 'FAILED',
    REFUNDED: 'REFUNDED',
} as const;

export type PaymentWebhookOutcome = (typeof PaymentWebhookOutcome)[keyof typeof PaymentWebhookOutcome];

export interface ProcessPaymentWebhookCommand extends ReceivePaymentWebhookCommand {
    readonly outcome: PaymentWebhookOutcome;
    readonly providerTransactionId?: string | null;
    readonly amount?: string | null;
    readonly errorCode?: string | null;
    readonly errorMessage?: string | null;
}
