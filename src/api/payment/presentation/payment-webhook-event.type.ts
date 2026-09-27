import { Field, ID, ObjectType } from '@nestjs/graphql';

import { PaymentWebhookEventStatus } from '~/api/payment/presentation/payment.enum';

@ObjectType('PaymentWebhookEvent')
export class PaymentWebhookEventType {
    @Field(() => ID)
    id!: string;

    @Field()
    provider!: string;

    @Field()
    providerEventId!: string;

    @Field(() => PaymentWebhookEventStatus)
    status!: PaymentWebhookEventStatus;

    @Field(() => ID, { nullable: true })
    paymentAttemptId!: string | null;

    @Field(() => Date)
    receivedAt!: Date;

    @Field(() => Date, { nullable: true })
    processedAt!: Date | null;

    @Field(() => String, { nullable: true })
    errorMessage!: string | null;
}
