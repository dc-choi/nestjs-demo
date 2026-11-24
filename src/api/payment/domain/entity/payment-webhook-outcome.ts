export const PaymentWebhookOutcome = {
    CAPTURED: 'CAPTURED',
    FAILED: 'FAILED',
    REFUNDED: 'REFUNDED',
} as const;

export type PaymentWebhookOutcome = (typeof PaymentWebhookOutcome)[keyof typeof PaymentWebhookOutcome];
