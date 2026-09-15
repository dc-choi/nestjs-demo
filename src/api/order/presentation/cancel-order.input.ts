import { Field, ID, InputType } from '@nestjs/graphql';

import { IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { GRAPHQL_ID_MAX_LENGTH, GRAPHQL_ID_PATTERN } from '~/global/graphql/graphql-id.parser';

@InputType()
export class CancelOrderInput {
    @Field(() => ID)
    @Matches(GRAPHQL_ID_PATTERN)
    @MaxLength(GRAPHQL_ID_MAX_LENGTH)
    orderId!: string;

    @Field()
    @IsString()
    @IsNotEmpty()
    @MaxLength(128)
    idempotencyKey!: string;

    @Field(() => String, { nullable: true })
    @IsOptional()
    @IsString()
    @IsNotEmpty()
    @MaxLength(255)
    reason?: string | null;
}
