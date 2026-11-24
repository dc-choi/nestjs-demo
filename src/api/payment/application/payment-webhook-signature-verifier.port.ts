export const PAYMENT_WEBHOOK_SIGNATURE_VERIFIER = Symbol('PAYMENT_WEBHOOK_SIGNATURE_VERIFIER');

export interface VerifyPaymentWebhookSignature {
    readonly provider: string;
    readonly providerEventId: string;
    readonly rawBody: Buffer;
    readonly signature: string;
}

export interface PaymentWebhookSignatureVerifier {
    verify(input: VerifyPaymentWebhookSignature): boolean | Promise<boolean>;
}
