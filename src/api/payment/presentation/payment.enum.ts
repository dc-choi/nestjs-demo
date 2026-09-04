import { registerEnumType } from '@nestjs/graphql';

import { PaymentWebhookOutcome } from '~/api/payment/application/payment.command';
import {
    PaymentAttemptStatus,
    PaymentTransactionStatus,
    PaymentTransactionType,
    PaymentWebhookEventStatus,
} from '~/api/payment/domain/payment.enum';

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
