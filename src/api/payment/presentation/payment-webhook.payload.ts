import { Field, ObjectType } from '@nestjs/graphql';

import { PaymentTransactionRecordType } from './payment-transaction-record.type';
import { PaymentWebhookEventType } from './payment-webhook-event.type';

@ObjectType()
export class PaymentWebhookPayload {
    @Field(() => PaymentWebhookEventType)
    event!: PaymentWebhookEventType;

    @Field(() => PaymentTransactionRecordType, { nullable: true })
    transaction!: PaymentTransactionRecordType | null;
}
