import { Field, InputType } from '@nestjs/graphql';

import { IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

const SHA256_PATTERN = /^[a-f\d]{64}$/i;

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
