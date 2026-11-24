import { registerEnumType } from '@nestjs/graphql';

import { PaymentAttemptStatus } from '~/api/payment/domain/payment-attempt-status.js';
import { PaymentTransactionStatus } from '~/api/payment/domain/payment-transaction-status.js';
import { PaymentTransactionType } from '~/api/payment/domain/payment-transaction-type.js';
import { PaymentWebhookEventStatus } from '~/api/payment/domain/payment-webhook-event-status.js';
import { PaymentWebhookOutcome } from '~/api/payment/domain/payment-webhook-outcome.js';

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
