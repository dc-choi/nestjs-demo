import { Field, InputType } from '@nestjs/graphql';

import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';
import {
    PRODUCT_NAME_MAX_LENGTH,
    PRODUCT_OPTION_CODE_MAX_LENGTH,
    PRODUCT_OPTION_CODE_PATTERN,
} from '~/api/catalog/domain/product.rules';
import { emptyValue, invalidMax, invalidValue } from '~/global/common/message/error.message';

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
