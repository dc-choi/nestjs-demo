import { Field, ID, ObjectType } from '@nestjs/graphql';

import { PaymentTransactionStatus, PaymentTransactionType } from '~/api/payment/presentation/payment.enum';
import { MoneyType } from '~/global/graphql/money.type';

@ObjectType('PaymentTransaction')
export class PaymentTransactionRecordType {
    @Field(() => ID)
    id!: string;

    @Field(() => PaymentTransactionType)
    type!: PaymentTransactionType;

    @Field(() => PaymentTransactionStatus)
    status!: PaymentTransactionStatus;

    @Field(() => MoneyType)
    amount!: MoneyType;

    @Field(() => String, { nullable: true })
    providerTransactionId!: string | null;

    @Field(() => String, { nullable: true })
    errorCode!: string | null;

    @Field(() => String, { nullable: true })
    errorMessage!: string | null;

    @Field(() => Date, { nullable: true })
    processedAt!: Date | null;
}
