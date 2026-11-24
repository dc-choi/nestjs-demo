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
