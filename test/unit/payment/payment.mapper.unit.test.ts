import { describe, expect, it } from 'vitest';
import type { PaymentResult } from '~/api/payment/application/payment.result.js';
import { toPaymentPayload } from '~/api/payment/presentation/payment.mapper.js';

describe('payment GraphQL mapper', () => {
    it('입력 그대로 저장된 금액도 DB에서 읽은 값과 같은 소수 셋째 자리 표기로 응답한다', () => {
        const transaction = {
            id: 2n,
            type: 'REFUND',
            status: 'SUCCEEDED',
            amount: '0100.5',
            providerTransactionId: 'tx-refund',
            errorCode: null,
            errorMessage: null,
            processedAt: new Date('2026-09-05T00:00:00.000Z'),
        };
        const attempt = {
            id: 1n,
            order: { id: 10n },
            provider: 'TEST',
            method: 'CARD',
            status: 'PARTIALLY_REFUNDED',
            requestedAmount: '100',
            currencyCode: 'KRW',
            providerPaymentId: 'payment-1',
            errorCode: null,
            errorMessage: null,
            capturedAt: null,
            transactions: { getItems: () => [transaction] },
        };

        const payload = toPaymentPayload({ attempt, transaction } as unknown as PaymentResult);

        expect(payload.payment.requestedAmount).toEqual({ amount: '100.000', currencyCode: 'KRW' });
        expect(payload.transaction?.amount).toEqual({ amount: '100.500', currencyCode: 'KRW' });
    });
});
