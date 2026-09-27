import { Field, InputType } from '@nestjs/graphql';

import { CapturePaymentInput } from './capture-payment.input';

import { Matches } from 'class-validator';
import { MONEY_PATTERN } from '~/api/payment/domain/payment-money';

@InputType()
export class RefundPaymentInput extends CapturePaymentInput {
    @Field()
    @Matches(MONEY_PATTERN)
    amount!: string;
}
