import { Field, ID, InputType, Int } from '@nestjs/graphql';

import { IsNotEmpty, IsNumber, Matches, Max, MaxLength, Min } from 'class-validator';
import { emptyValue, invalidMax, invalidMin, invalidValue } from '~/global/common/message/error.message';

export const DECIMAL_ITEM_ID_PATTERN = /^[1-9]\d*$/;

@InputType()
export class PlaceOrderItemInput {
    @Field(() => ID)
    @IsNotEmpty({ message: emptyValue('상품 ID') })
    @Matches(DECIMAL_ITEM_ID_PATTERN, { message: invalidValue('상품 ID') })
    @MaxLength(19, { message: invalidValue('상품 ID') })
    itemId: string;

    @Field(() => Int)
    @IsNotEmpty({ message: emptyValue('수량') })
    @IsNumber({}, { message: invalidValue('수량') })
    @Min(1, { message: invalidMin('수량', 1) })
    @Max(Number.MAX_SAFE_INTEGER, { message: invalidMax('수량', Number.MAX_SAFE_INTEGER) })
    quantity: number;
}
