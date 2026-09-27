import { Field, ID, InputType } from '@nestjs/graphql';

import { IdempotentPaymentInput } from './idempotent-payment.input';

import { IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { GRAPHQL_ID_MAX_LENGTH, GRAPHQL_ID_PATTERN } from '~/global/graphql/graphql-id.parser';

@InputType()
export class FailPaymentInput extends IdempotentPaymentInput {
    @Field(() => ID)
    @Matches(GRAPHQL_ID_PATTERN)
    @MaxLength(GRAPHQL_ID_MAX_LENGTH)
    paymentAttemptId!: string;

    @Field()
    @IsString()
    @IsNotEmpty()
    @MaxLength(128)
    errorCode!: string;

    @Field(() => String, { nullable: true })
    @IsOptional()
    @IsString()
    errorMessage?: string | null;
}
