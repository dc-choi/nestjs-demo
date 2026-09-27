import { Field, InputType } from '@nestjs/graphql';

import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

@InputType({ isAbstract: true })
export class IdempotentPaymentInput {
    @Field()
    @IsString()
    @IsNotEmpty()
    @MaxLength(128)
    idempotencyKey!: string;
}
