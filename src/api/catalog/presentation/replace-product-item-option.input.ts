import { Field, InputType } from '@nestjs/graphql';

import { IsString, Matches } from 'class-validator';
import { PRODUCT_OPTION_CODE_PATTERN } from '~/api/catalog/domain/product.rules';
import { invalidValue } from '~/global/common/message/error.message';

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
