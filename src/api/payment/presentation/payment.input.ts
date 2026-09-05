import { BadRequestException } from '@nestjs/common';
import { Field, ID, InputType } from '@nestjs/graphql';

import { IsEnum, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { PaymentWebhookOutcome } from '~/api/payment/presentation/payment.enum';

const DECIMAL_ID_PATTERN = /^[1-9]\d*$/;
const MONEY_PATTERN = /^\d+(?:\.\d{1,3})?$/;
const SHA256_PATTERN = /^[a-f\d]{64}$/i;

@InputType({ isAbstract: true })
class IdempotentPaymentInput {
    @Field()
    @IsString()
    @IsNotEmpty()
    @MaxLength(128)
    idempotencyKey!: string;
}

@InputType()
export class CreatePaymentAttemptInput extends IdempotentPaymentInput {
    @Field(() => ID)
    @Matches(DECIMAL_ID_PATTERN)
    @MaxLength(19)
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

@InputType()
export class CapturePaymentInput extends IdempotentPaymentInput {
    @Field(() => ID)
    @Matches(DECIMAL_ID_PATTERN)
    @MaxLength(19)
    paymentAttemptId!: string;

    @Field()
    @IsString()
    @IsNotEmpty()
    @MaxLength(255)
    providerTransactionId!: string;
}

@InputType()
export class FailPaymentInput extends IdempotentPaymentInput {
    @Field(() => ID)
    @Matches(DECIMAL_ID_PATTERN)
    @MaxLength(19)
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

@InputType()
export class RefundPaymentInput extends CapturePaymentInput {
    @Field()
    @Matches(MONEY_PATTERN)
    amount!: string;
}

@InputType()
export class ReceivePaymentWebhookInput {
    @Field()
    @IsString()
    @IsNotEmpty()
    @MaxLength(64)
    provider!: string;

    @Field()
    @IsString()
    @IsNotEmpty()
    @MaxLength(255)
    providerEventId!: string;

    @Field(() => String, { nullable: true })
    @IsOptional()
    @IsString()
    @MaxLength(255)
    providerPaymentId?: string | null;

    @Field()
    @Matches(SHA256_PATTERN)
    payloadHash!: string;
}

@InputType()
export class ProcessPaymentWebhookInput extends ReceivePaymentWebhookInput {
    @Field(() => PaymentWebhookOutcome)
    @IsEnum(PaymentWebhookOutcome)
    outcome!: PaymentWebhookOutcome;

    @Field(() => String, { nullable: true })
    @IsOptional()
    @IsString()
    @MaxLength(255)
    providerTransactionId?: string | null;

    @Field(() => String, { nullable: true })
    @IsOptional()
    @Matches(MONEY_PATTERN)
    amount?: string | null;

    @Field(() => String, { nullable: true })
    @IsOptional()
    @IsString()
    @MaxLength(128)
    errorCode?: string | null;

    @Field(() => String, { nullable: true })
    @IsOptional()
    @IsString()
    errorMessage?: string | null;
}

@InputType()
export class FailPaymentWebhookInput {
    @Field()
    @IsString()
    @IsNotEmpty()
    @MaxLength(64)
    provider!: string;

    @Field()
    @IsString()
    @IsNotEmpty()
    @MaxLength(255)
    providerEventId!: string;

    @Field()
    @IsString()
    @IsNotEmpty()
    errorMessage!: string;
}

export function parsePaymentId(value: string): bigint {
    if (value.length > 19 || !DECIMAL_ID_PATTERN.test(value)) {
        throw new BadRequestException('유효하지 않은 ID입니다.');
    }
    const id = BigInt(value);
    if (id > 9_223_372_036_854_775_807n) throw new BadRequestException('유효하지 않은 ID입니다.');
    return id;
}
