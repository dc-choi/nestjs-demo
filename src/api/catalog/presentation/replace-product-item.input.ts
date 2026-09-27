import { Field, ID, InputType } from '@nestjs/graphql';

import { ItemSaleStatus } from './item-sale-status.enum';
import { ReplaceProductItemOptionInput } from './replace-product-item-option.input';

import { Type } from 'class-transformer';
import {
    ArrayMaxSize,
    IsArray,
    IsBoolean,
    IsEnum,
    IsNotEmpty,
    IsOptional,
    IsString,
    Matches,
    MaxLength,
    ValidateNested,
} from 'class-validator';
import {
    PRODUCT_CATALOG_LIMITS,
    PRODUCT_ITEM_SKU_MAX_LENGTH,
    PRODUCT_NAME_MAX_LENGTH,
    PRODUCT_PRICE_PATTERN,
} from '~/api/catalog/domain/product.rules';
import { emptyValue, invalidMax, invalidValue } from '~/global/common/message/error.message';
import { GRAPHQL_ID_MAX_LENGTH, GRAPHQL_ID_PATTERN } from '~/global/graphql/graphql-id.parser';

@InputType()
export class ReplaceProductItemInput {
    @Field(() => ID, { nullable: true })
    @IsOptional()
    @Matches(GRAPHQL_ID_PATTERN, { message: invalidValue('Item ID') })
    @MaxLength(GRAPHQL_ID_MAX_LENGTH, { message: invalidValue('Item ID') })
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
