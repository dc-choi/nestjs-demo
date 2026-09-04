import { Field, InputType } from '@nestjs/graphql';

import { IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import {
    PRODUCT_NAME_MAX_LENGTH,
    PRODUCT_REASON_MAX_LENGTH,
    PRODUCT_SLUG_MAX_LENGTH,
    PRODUCT_SLUG_PATTERN,
    PRODUCT_TEXT_MAX_LENGTH,
} from '~/api/catalog/domain/product.rules';
import { emptyValue, invalidMax, invalidValue } from '~/global/common/message/error.message';

@InputType()
export class CreateProductInput {
    @Field()
    @IsString({ message: invalidValue('상품 slug') })
    @IsNotEmpty({ message: emptyValue('상품 slug') })
    @MaxLength(PRODUCT_SLUG_MAX_LENGTH, { message: invalidMax('상품 slug', PRODUCT_SLUG_MAX_LENGTH) })
    @Matches(PRODUCT_SLUG_PATTERN, { message: invalidValue('상품 slug') })
    slug: string;

    @Field()
    @IsString({ message: invalidValue('상품명') })
    @IsNotEmpty({ message: emptyValue('상품명') })
    @MaxLength(PRODUCT_NAME_MAX_LENGTH, { message: invalidMax('상품명', PRODUCT_NAME_MAX_LENGTH) })
    name: string;

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

    @Field(() => String, { nullable: true })
    @IsOptional()
    @IsString({ message: invalidValue('변경 사유') })
    @MaxLength(PRODUCT_REASON_MAX_LENGTH, { message: invalidMax('변경 사유', PRODUCT_REASON_MAX_LENGTH) })
    reason?: string | null;
}
