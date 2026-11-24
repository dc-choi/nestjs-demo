import { Field, ID, ObjectType } from '@nestjs/graphql';

import { PaymentTransactionRecordType } from './payment-transaction-record.type.js';

import { PaymentAttemptStatus } from '~/api/payment/presentation/payment.enum.js';
import { MoneyType } from '~/global/graphql/money.type.js';

@ObjectType('PaymentAttempt')
export class PaymentAttemptType {
    @Field(() => ID)
    id!: string;

    @Field(() => ID)
    orderId!: string;

    @Field()
    provider!: string;

    @Field(() => String, { nullable: true })
    method!: string | null;

    @Field(() => PaymentAttemptStatus)
    status!: PaymentAttemptStatus;

    @Field(() => MoneyType)
    requestedAmount!: MoneyType;

    @Field(() => String, { nullable: true })
    providerPaymentId!: string | null;

    @Field(() => String, { nullable: true })
    errorCode!: string | null;

    @Field(() => String, { nullable: true })
    errorMessage!: string | null;

    @Field(() => Date, { nullable: true })
    capturedAt!: Date | null;

    @Field(() => [PaymentTransactionRecordType])
    transactions!: PaymentTransactionRecordType[];
}
