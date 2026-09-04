export const PaymentAttemptStatus = {
    PENDING: 'PENDING',
    REQUIRES_ACTION: 'REQUIRES_ACTION',
    AUTHORIZED: 'AUTHORIZED',
    CAPTURED: 'CAPTURED',
    PARTIALLY_REFUNDED: 'PARTIALLY_REFUNDED',
    REFUNDED: 'REFUNDED',
    CANCELLED: 'CANCELLED',
    FAILED: 'FAILED',
} as const;

export type PaymentAttemptStatus = (typeof PaymentAttemptStatus)[keyof typeof PaymentAttemptStatus];

export const PaymentTransactionType = {
    AUTHORIZE: 'AUTHORIZE',
    CAPTURE: 'CAPTURE',
    REFUND: 'REFUND',
    VOID: 'VOID',
} as const;

export type PaymentTransactionType = (typeof PaymentTransactionType)[keyof typeof PaymentTransactionType];

export const PaymentTransactionStatus = {
    PENDING: 'PENDING',
    SUCCEEDED: 'SUCCEEDED',
    FAILED: 'FAILED',
} as const;

export type PaymentTransactionStatus = (typeof PaymentTransactionStatus)[keyof typeof PaymentTransactionStatus];

export const PaymentWebhookEventStatus = {
    RECEIVED: 'RECEIVED',
    PROCESSED: 'PROCESSED',
    FAILED: 'FAILED',
} as const;

export type PaymentWebhookEventStatus = (typeof PaymentWebhookEventStatus)[keyof typeof PaymentWebhookEventStatus];
