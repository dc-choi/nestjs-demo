import { Field, InputType } from '@nestjs/graphql';

import { ReceivePaymentWebhookInput } from './receive-payment-webhook.input';

import { IsEnum, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { MONEY_PATTERN } from '~/api/payment/domain/payment-money';
import { PaymentWebhookOutcome } from '~/api/payment/presentation/payment.enum';

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
