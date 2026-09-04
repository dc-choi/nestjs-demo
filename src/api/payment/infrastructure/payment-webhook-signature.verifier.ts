import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { EnvConfig } from '~/global/config/env/env.config';

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

@Injectable()
export class HmacPaymentWebhookSignatureVerifier implements PaymentWebhookSignatureVerifier {
    constructor(private readonly configService: ConfigService<EnvConfig, true>) {}

    verify({ provider, providerEventId, rawBody, signature }: VerifyPaymentWebhookSignature): boolean {
        const secret =
            this.configService.get<string>('PAYMENT_WEBHOOK_SECRET') ?? this.configService.get<string>('SECRET');
        if (!secret) return false;

        const suppliedHex = signature.startsWith('sha256=') ? signature.slice(7) : signature;
        if (!/^[a-f\d]{64}$/i.test(suppliedHex)) return false;

        const expected = createHmac('sha256', secret)
            .update(provider)
            .update('.')
            .update(providerEventId)
            .update('.')
            .update(rawBody)
            .digest();
        const supplied = Buffer.from(suppliedHex, 'hex');
        return supplied.length === expected.length && timingSafeEqual(supplied, expected);
    }
}
