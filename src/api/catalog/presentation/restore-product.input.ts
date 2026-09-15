import { Field, ID, InputType, Int } from '@nestjs/graphql';

import { IsInt, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';
import { PRODUCT_REASON_MAX_LENGTH } from '~/api/catalog/domain/product.rules';
import { invalidMax, invalidMin, invalidValue } from '~/global/common/message/error.message';
import { GRAPHQL_ID_MAX_LENGTH, GRAPHQL_ID_PATTERN } from '~/global/graphql/graphql-id.parser';

@InputType()
export class RestoreProductInput {
    @Field(() => ID)
    @Matches(GRAPHQL_ID_PATTERN, { message: invalidValue('상품 ID') })
    @MaxLength(GRAPHQL_ID_MAX_LENGTH, { message: invalidValue('상품 ID') })
    productId!: string;

    @Field(() => Int)
    @IsInt({ message: invalidValue('기대 revision') })
    @Min(1, { message: invalidMin('기대 revision', 1) })
    expectedRevision!: number;

    @Field(() => Int)
    @IsInt({ message: invalidValue('복원 revision') })
    @Min(1, { message: invalidMin('복원 revision', 1) })
    sourceRevision!: number;

    @Field(() => String, { nullable: true })
    @IsOptional()
    @IsString({ message: invalidValue('변경 사유') })
    @MaxLength(PRODUCT_REASON_MAX_LENGTH, { message: invalidMax('변경 사유', PRODUCT_REASON_MAX_LENGTH) })
    reason?: string | null;
}
