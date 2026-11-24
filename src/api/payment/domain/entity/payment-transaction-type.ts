export const PaymentTransactionType = {
    AUTHORIZE: 'AUTHORIZE',
    CAPTURE: 'CAPTURE',
    REFUND: 'REFUND',
    VOID: 'VOID',
} as const;

export type PaymentTransactionType = (typeof PaymentTransactionType)[keyof typeof PaymentTransactionType];
