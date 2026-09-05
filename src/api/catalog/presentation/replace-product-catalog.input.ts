import { Field, ID, InputType, Int } from '@nestjs/graphql';

import { Type } from 'class-transformer';
import {
    ArrayMaxSize,
    ArrayUnique,
    IsArray,
    IsBoolean,
    IsEnum,
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
    PRODUCT_ITEM_SKU_MAX_LENGTH,
    PRODUCT_NAME_MAX_LENGTH,
    PRODUCT_OPTION_CODE_MAX_LENGTH,
    PRODUCT_OPTION_CODE_PATTERN,
    PRODUCT_PRICE_PATTERN,
    PRODUCT_REASON_MAX_LENGTH,
    PRODUCT_TAG_MAX_LENGTH,
} from '~/api/catalog/domain/product.rules';
import { ItemSaleStatus } from '~/api/catalog/presentation/item-sale-status.enum';
import { DECIMAL_PRODUCT_ID_PATTERN, PRODUCT_ID_MAX_LENGTH } from '~/api/catalog/presentation/product-id.parser';
import { emptyValue, invalidMax, invalidMin, invalidValue } from '~/global/common/message/error.message';

@InputType()
export class ReplaceProductOptionValueInput {
    @Field()
    @IsString({ message: invalidValue('옵션 값 code') })
    @IsNotEmpty({ message: emptyValue('옵션 값 code') })
    @MaxLength(PRODUCT_OPTION_CODE_MAX_LENGTH, {
        message: invalidMax('옵션 값 code', PRODUCT_OPTION_CODE_MAX_LENGTH),
    })
    @Matches(PRODUCT_OPTION_CODE_PATTERN, { message: invalidValue('옵션 값 code') })
    code!: string;

    @Field()
    @IsString({ message: invalidValue('옵션 값 이름') })
    @IsNotEmpty({ message: emptyValue('옵션 값 이름') })
    @MaxLength(PRODUCT_NAME_MAX_LENGTH, { message: invalidMax('옵션 값 이름', PRODUCT_NAME_MAX_LENGTH) })
    name!: string;
}

@InputType()
export class ReplaceProductOptionInput {
    @Field()
    @IsString({ message: invalidValue('옵션 code') })
    @IsNotEmpty({ message: emptyValue('옵션 code') })
    @MaxLength(PRODUCT_OPTION_CODE_MAX_LENGTH, { message: invalidMax('옵션 code', PRODUCT_OPTION_CODE_MAX_LENGTH) })
    @Matches(PRODUCT_OPTION_CODE_PATTERN, { message: invalidValue('옵션 code') })
    code!: string;

    @Field()
    @IsString({ message: invalidValue('옵션 이름') })
    @IsNotEmpty({ message: emptyValue('옵션 이름') })
    @MaxLength(PRODUCT_NAME_MAX_LENGTH, { message: invalidMax('옵션 이름', PRODUCT_NAME_MAX_LENGTH) })
    name!: string;

    @Field()
    @IsBoolean({ message: invalidValue('필수 옵션 여부') })
    isRequired!: boolean;

    @Field(() => [ReplaceProductOptionValueInput])
    @IsArray({ message: invalidValue('옵션 값') })
    @ArrayMaxSize(PRODUCT_CATALOG_LIMITS.optionValues, {
        message: invalidMax('옵션 값 수', PRODUCT_CATALOG_LIMITS.optionValues),
    })
    @Type(() => ReplaceProductOptionValueInput)
    @ValidateNested({ each: true })
    values!: ReplaceProductOptionValueInput[];
}

@InputType()
export class ReplaceProductItemOptionInput {
    @Field()
    @IsString({ message: invalidValue('선택 옵션 code') })
    @Matches(PRODUCT_OPTION_CODE_PATTERN, { message: invalidValue('선택 옵션 code') })
    optionCode!: string;

    @Field()
    @IsString({ message: invalidValue('선택 옵션 값 code') })
    @Matches(PRODUCT_OPTION_CODE_PATTERN, { message: invalidValue('선택 옵션 값 code') })
    valueCode!: string;
}

@InputType()
export class ReplaceProductItemInput {
    @Field(() => ID, { nullable: true })
    @IsOptional()
    @Matches(DECIMAL_PRODUCT_ID_PATTERN, { message: invalidValue('Item ID') })
    @MaxLength(PRODUCT_ID_MAX_LENGTH, { message: invalidValue('Item ID') })
    id?: string | null;

    @Field(() => String, { nullable: true })
    @IsOptional()
    @IsString({ message: invalidValue('SKU') })
    @IsNotEmpty({ message: emptyValue('SKU') })
    @MaxLength(PRODUCT_ITEM_SKU_MAX_LENGTH, { message: invalidMax('SKU', PRODUCT_ITEM_SKU_MAX_LENGTH) })
    sku?: string | null;

    @Field()
    @IsString({ message: invalidValue('Item 이름') })
    @IsNotEmpty({ message: emptyValue('Item 이름') })
    @MaxLength(PRODUCT_NAME_MAX_LENGTH, { message: invalidMax('Item 이름', PRODUCT_NAME_MAX_LENGTH) })
    name!: string;

    @Field()
    @Matches(PRODUCT_PRICE_PATTERN, { message: invalidValue('공급가') })
    supplyPrice!: string;

    @Field()
    @Matches(PRODUCT_PRICE_PATTERN, { message: invalidValue('부가세') })
    vat!: string;

    @Field()
    @IsBoolean({ message: invalidValue('면세 여부') })
    isTaxFree!: boolean;

    @Field(() => ItemSaleStatus)
    @IsEnum(ItemSaleStatus, { message: invalidValue('Item 판매 상태') })
    saleStatus!: ItemSaleStatus;

    @Field(() => [ReplaceProductItemOptionInput])
    @IsArray({ message: invalidValue('선택 옵션') })
    @ArrayMaxSize(PRODUCT_CATALOG_LIMITS.options, {
        message: invalidMax('선택 옵션 수', PRODUCT_CATALOG_LIMITS.options),
    })
    @Type(() => ReplaceProductItemOptionInput)
    @ValidateNested({ each: true })
    selectedOptions!: ReplaceProductItemOptionInput[];
}

@InputType()
export class ReplaceProductCatalogInput {
    @Field(() => ID)
    @Matches(DECIMAL_PRODUCT_ID_PATTERN, { message: invalidValue('상품 ID') })
    @MaxLength(PRODUCT_ID_MAX_LENGTH, { message: invalidValue('상품 ID') })
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
    @Matches(DECIMAL_PRODUCT_ID_PATTERN, { each: true, message: invalidValue('카테고리 ID') })
    @MaxLength(PRODUCT_ID_MAX_LENGTH, { each: true, message: invalidValue('카테고리 ID') })
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
