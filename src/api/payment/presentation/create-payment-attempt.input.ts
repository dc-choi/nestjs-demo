import { Field, ID, InputType } from '@nestjs/graphql';

import { IdempotentPaymentInput } from './idempotent-payment.input';

import { IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { GRAPHQL_ID_MAX_LENGTH, GRAPHQL_ID_PATTERN } from '~/global/graphql/graphql-id.parser';

@InputType()
export class CreatePaymentAttemptInput extends IdempotentPaymentInput {
    @Field(() => ID)
    @Matches(GRAPHQL_ID_PATTERN)
    @MaxLength(GRAPHQL_ID_MAX_LENGTH)
    orderId!: string;

    @Field()
    @IsString()
    @IsNotEmpty()
    @MaxLength(64)
    provider!: string;

    @Field(() => String, { nullable: true })
    @IsOptional()
    @IsString()
    @MaxLength(64)
    method?: string | null;

    @Field(() => String, { nullable: true })
    @IsOptional()
    @IsString()
    @MaxLength(255)
    providerPaymentId?: string | null;
}
