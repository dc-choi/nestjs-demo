export const PaymentWebhookEventStatus = {
    RECEIVED: 'RECEIVED',
    PROCESSED: 'PROCESSED',
    FAILED: 'FAILED',
} as const;

export type PaymentWebhookEventStatus = (typeof PaymentWebhookEventStatus)[keyof typeof PaymentWebhookEventStatus];
