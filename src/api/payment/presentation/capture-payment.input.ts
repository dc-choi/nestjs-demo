import { Field, ID, InputType } from '@nestjs/graphql';

import { IdempotentPaymentInput } from './idempotent-payment.input';

import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';
import { GRAPHQL_ID_MAX_LENGTH, GRAPHQL_ID_PATTERN } from '~/global/graphql/graphql-id.parser';

@InputType()
export class CapturePaymentInput extends IdempotentPaymentInput {
    @Field(() => ID)
    @Matches(GRAPHQL_ID_PATTERN)
    @MaxLength(GRAPHQL_ID_MAX_LENGTH)
    paymentAttemptId!: string;

    @Field()
    @IsString()
    @IsNotEmpty()
    @MaxLength(255)
    providerTransactionId!: string;
}
