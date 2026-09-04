import { Field, ID, ObjectType } from '@nestjs/graphql';

import {
    PaymentAttemptStatus,
    PaymentTransactionStatus,
    PaymentTransactionType,
    PaymentWebhookEventStatus,
} from '~/api/payment/presentation/payment.enum';
import { MoneyType } from '~/global/graphql/money.type';

@ObjectType('PaymentTransaction')
export class PaymentTransactionRecordType {
    @Field(() => ID)
    id: string;

    @Field(() => PaymentTransactionType)
    type: PaymentTransactionType;

    @Field(() => PaymentTransactionStatus)
    status: PaymentTransactionStatus;

    @Field(() => MoneyType)
    amount: MoneyType;

    @Field(() => String, { nullable: true })
    providerTransactionId: string | null;

    @Field(() => String, { nullable: true })
    errorCode: string | null;

    @Field(() => String, { nullable: true })
    errorMessage: string | null;

    @Field(() => Date, { nullable: true })
    processedAt: Date | null;
}

@ObjectType('PaymentAttempt')
export class PaymentAttemptType {
    @Field(() => ID)
    id: string;

    @Field(() => ID)
    orderId: string;

    @Field()
    provider: string;

    @Field(() => String, { nullable: true })
    method: string | null;

    @Field(() => PaymentAttemptStatus)
    status: PaymentAttemptStatus;

    @Field(() => MoneyType)
    requestedAmount: MoneyType;

    @Field(() => String, { nullable: true })
    providerPaymentId: string | null;

    @Field(() => String, { nullable: true })
    errorCode: string | null;

    @Field(() => String, { nullable: true })
    errorMessage: string | null;

    @Field(() => Date, { nullable: true })
    capturedAt: Date | null;

    @Field(() => [PaymentTransactionRecordType])
    transactions: PaymentTransactionRecordType[];
}

@ObjectType()
export class PaymentPayload {
    @Field(() => PaymentAttemptType)
    payment: PaymentAttemptType;

    @Field(() => PaymentTransactionRecordType, { nullable: true })
    transaction: PaymentTransactionRecordType | null;
}

@ObjectType('PaymentWebhookEvent')
export class PaymentWebhookEventType {
    @Field(() => ID)
    id: string;

    @Field()
    provider: string;

    @Field()
    providerEventId: string;

    @Field(() => PaymentWebhookEventStatus)
    status: PaymentWebhookEventStatus;

    @Field(() => ID, { nullable: true })
    paymentAttemptId: string | null;

    @Field(() => Date)
    receivedAt: Date;

    @Field(() => Date, { nullable: true })
    processedAt: Date | null;

    @Field(() => String, { nullable: true })
    errorMessage: string | null;
}

@ObjectType()
export class PaymentWebhookPayload {
    @Field(() => PaymentWebhookEventType)
    event: PaymentWebhookEventType;

    @Field(() => PaymentTransactionRecordType, { nullable: true })
    transaction: PaymentTransactionRecordType | null;
}
