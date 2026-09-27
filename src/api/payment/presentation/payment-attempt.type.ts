import { Field, ID, ObjectType } from '@nestjs/graphql';

import { PaymentTransactionRecordType } from './payment-transaction-record.type';

import { PaymentAttemptStatus } from '~/api/payment/presentation/payment.enum';
import { MoneyType } from '~/global/graphql/money.type';

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
