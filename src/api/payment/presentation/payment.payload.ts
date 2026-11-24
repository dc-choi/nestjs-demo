import { Field, ObjectType } from '@nestjs/graphql';

import { PaymentAttemptType } from './payment-attempt.type.js';
import { PaymentTransactionRecordType } from './payment-transaction-record.type.js';

@ObjectType()
export class PaymentPayload {
    @Field(() => PaymentAttemptType)
    payment!: PaymentAttemptType;

    @Field(() => PaymentTransactionRecordType, { nullable: true })
    transaction!: PaymentTransactionRecordType | null;
}
