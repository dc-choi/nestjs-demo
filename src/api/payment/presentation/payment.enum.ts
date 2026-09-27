import { registerEnumType } from '@nestjs/graphql';

import { PaymentAttemptStatus } from '~/api/payment/domain/payment-attempt-status';
import { PaymentTransactionStatus } from '~/api/payment/domain/payment-transaction-status';
import { PaymentTransactionType } from '~/api/payment/domain/payment-transaction-type';
import { PaymentWebhookEventStatus } from '~/api/payment/domain/payment-webhook-event-status';
import { PaymentWebhookOutcome } from '~/api/payment/domain/payment-webhook-outcome';

registerEnumType(PaymentAttemptStatus, { name: 'PaymentAttemptStatus' });
registerEnumType(PaymentTransactionStatus, { name: 'PaymentTransactionStatus' });
registerEnumType(PaymentTransactionType, { name: 'PaymentTransactionType' });
registerEnumType(PaymentWebhookEventStatus, { name: 'PaymentWebhookEventStatus' });
registerEnumType(PaymentWebhookOutcome, { name: 'PaymentWebhookOutcome' });

export {
    PaymentAttemptStatus,
    PaymentTransactionStatus,
    PaymentTransactionType,
    PaymentWebhookEventStatus,
    PaymentWebhookOutcome,
};
