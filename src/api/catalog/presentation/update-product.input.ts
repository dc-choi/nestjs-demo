import { Field, ID, InputType, Int } from '@nestjs/graphql';

import { IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, Min, ValidateIf } from 'class-validator';
import {
    PRODUCT_NAME_MAX_LENGTH,
    PRODUCT_REASON_MAX_LENGTH,
    PRODUCT_SLUG_MAX_LENGTH,
    PRODUCT_SLUG_PATTERN,
    PRODUCT_TEXT_MAX_LENGTH,
} from '~/api/catalog/domain/product.rules';
import { DECIMAL_PRODUCT_ID_PATTERN, PRODUCT_ID_MAX_LENGTH } from '~/api/catalog/presentation/product-id.parser';
import { ProductStatus } from '~/api/catalog/presentation/product-status.enum';
import { invalidMax, invalidMin, invalidValue } from '~/global/common/message/error.message';

@InputType()
export class UpdateProductInput {
    @Field(() => ID)
    @Matches(DECIMAL_PRODUCT_ID_PATTERN, { message: invalidValue('상품 ID') })
    @MaxLength(PRODUCT_ID_MAX_LENGTH, { message: invalidValue('상품 ID') })
    productId!: string;

    @Field(() => Int)
    @IsInt({ message: invalidValue('기대 revision') })
    @Min(1, { message: invalidMin('기대 revision', 1) })
    expectedRevision!: number;

    @Field(() => String, { nullable: true })
    @ValidateIf((_, value) => value !== undefined)
    @IsString({ message: invalidValue('상품 slug') })
    @MaxLength(PRODUCT_SLUG_MAX_LENGTH, { message: invalidMax('상품 slug', PRODUCT_SLUG_MAX_LENGTH) })
    @Matches(PRODUCT_SLUG_PATTERN, { message: invalidValue('상품 slug') })
    slug?: string;

    @Field(() => String, { nullable: true })
    @ValidateIf((_, value) => value !== undefined)
    @IsString({ message: invalidValue('상품명') })
    @IsNotEmpty({ message: invalidValue('상품명') })
    @MaxLength(PRODUCT_NAME_MAX_LENGTH, { message: invalidMax('상품명', PRODUCT_NAME_MAX_LENGTH) })
    name?: string;

    @Field(() => String, { nullable: true })
    @IsOptional()
    @IsString({ message: invalidValue('상품 설명') })
    @MaxLength(PRODUCT_TEXT_MAX_LENGTH, { message: invalidMax('상품 설명', PRODUCT_TEXT_MAX_LENGTH) })
    description?: string | null;

    @Field(() => String, { nullable: true })
    @IsOptional()
    @IsString({ message: invalidValue('반품 정책') })
    @MaxLength(PRODUCT_TEXT_MAX_LENGTH, { message: invalidMax('반품 정책', PRODUCT_TEXT_MAX_LENGTH) })
    returnPolicy?: string | null;

    @Field(() => ProductStatus, { nullable: true })
    @ValidateIf((_, value) => value !== undefined)
    @IsEnum(ProductStatus, { message: invalidValue('상품 상태') })
    status?: ProductStatus;

    @Field(() => String, { nullable: true })
    @IsOptional()
    @IsString({ message: invalidValue('변경 사유') })
    @MaxLength(PRODUCT_REASON_MAX_LENGTH, { message: invalidMax('변경 사유', PRODUCT_REASON_MAX_LENGTH) })
    reason?: string | null;
}
