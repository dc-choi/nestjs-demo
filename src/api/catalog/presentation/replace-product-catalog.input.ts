import { Field, ID, InputType, Int } from '@nestjs/graphql';

import { ReplaceProductItemInput } from './replace-product-item.input';
import { ReplaceProductOptionInput } from './replace-product-option.input';

import { Type } from 'class-transformer';
import {
    ArrayMaxSize,
    ArrayUnique,
    IsArray,
    IsInt,
    IsNotEmpty,
    IsOptional,
    IsString,
    Matches,
    MaxLength,
    Min,
    ValidateNested,
} from 'class-validator';
import {
    PRODUCT_CATALOG_LIMITS,
    PRODUCT_REASON_MAX_LENGTH,
    PRODUCT_TAG_MAX_LENGTH,
} from '~/api/catalog/domain/product.rules';
import { emptyValue, invalidMax, invalidMin, invalidValue } from '~/global/common/message/error.message';
import { GRAPHQL_ID_MAX_LENGTH, GRAPHQL_ID_PATTERN } from '~/global/graphql/graphql-id.parser';

@InputType()
export class ReplaceProductCatalogInput {
    @Field(() => ID)
    @Matches(GRAPHQL_ID_PATTERN, { message: invalidValue('상품 ID') })
    @MaxLength(GRAPHQL_ID_MAX_LENGTH, { message: invalidValue('상품 ID') })
    productId!: string;

    @Field(() => Int)
    @IsInt({ message: invalidValue('기대 revision') })
    @Min(1, { message: invalidMin('기대 revision', 1) })
    expectedRevision!: number;

    @Field(() => [ReplaceProductOptionInput])
    @IsArray({ message: invalidValue('옵션') })
    @ArrayMaxSize(PRODUCT_CATALOG_LIMITS.options, {
        message: invalidMax('옵션 수', PRODUCT_CATALOG_LIMITS.options),
    })
    @Type(() => ReplaceProductOptionInput)
    @ValidateNested({ each: true })
    options!: ReplaceProductOptionInput[];

    @Field(() => [ReplaceProductItemInput])
    @IsArray({ message: invalidValue('Item') })
    @ArrayMaxSize(PRODUCT_CATALOG_LIMITS.items, { message: invalidMax('Item 수', PRODUCT_CATALOG_LIMITS.items) })
    @Type(() => ReplaceProductItemInput)
    @ValidateNested({ each: true })
    items!: ReplaceProductItemInput[];

    @Field(() => [ID])
    @IsArray({ message: invalidValue('카테고리 ID') })
    @ArrayMaxSize(PRODUCT_CATALOG_LIMITS.categories, {
        message: invalidMax('카테고리 수', PRODUCT_CATALOG_LIMITS.categories),
    })
    @ArrayUnique({ message: invalidValue('카테고리 ID') })
    @Matches(GRAPHQL_ID_PATTERN, { each: true, message: invalidValue('카테고리 ID') })
    @MaxLength(GRAPHQL_ID_MAX_LENGTH, { each: true, message: invalidValue('카테고리 ID') })
    categoryIds!: string[];

    @Field(() => [String])
    @IsArray({ message: invalidValue('태그') })
    @ArrayMaxSize(PRODUCT_CATALOG_LIMITS.tags, { message: invalidMax('태그 수', PRODUCT_CATALOG_LIMITS.tags) })
    @ArrayUnique({ message: invalidValue('태그') })
    @IsString({ each: true, message: invalidValue('태그') })
    @IsNotEmpty({ each: true, message: emptyValue('태그') })
    @MaxLength(PRODUCT_TAG_MAX_LENGTH, { each: true, message: invalidMax('태그', PRODUCT_TAG_MAX_LENGTH) })
    tags!: string[];

    @Field(() => String, { nullable: true })
    @IsOptional()
    @IsString({ message: invalidValue('변경 사유') })
    @MaxLength(PRODUCT_REASON_MAX_LENGTH, { message: invalidMax('변경 사유', PRODUCT_REASON_MAX_LENGTH) })
    reason?: string | null;
}
