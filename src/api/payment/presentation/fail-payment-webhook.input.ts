import { Field, InputType } from '@nestjs/graphql';

import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

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
