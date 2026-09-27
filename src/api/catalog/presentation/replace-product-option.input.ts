import { Field, InputType } from '@nestjs/graphql';

import { ReplaceProductOptionValueInput } from './replace-product-option-value.input';

import { Type } from 'class-transformer';
import {
    ArrayMaxSize,
    IsArray,
    IsBoolean,
    IsNotEmpty,
    IsString,
    Matches,
    MaxLength,
    ValidateNested,
} from 'class-validator';
import {
    PRODUCT_CATALOG_LIMITS,
    PRODUCT_NAME_MAX_LENGTH,
    PRODUCT_OPTION_CODE_MAX_LENGTH,
    PRODUCT_OPTION_CODE_PATTERN,
} from '~/api/catalog/domain/product.rules';
import { emptyValue, invalidMax, invalidValue } from '~/global/common/message/error.message';

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
