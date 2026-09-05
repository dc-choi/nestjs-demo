import { Field, InputType } from '@nestjs/graphql';

import { Type } from 'class-transformer';
import { ArrayMinSize, IsNotEmpty, IsString, MaxLength, ValidateNested } from 'class-validator';
import { PlaceOrderItemInput } from '~/api/order/presentation/place-order-item.input';
import { emptyValue } from '~/global/common/message/error.message';

@InputType()
export class PlaceOrderInput {
    @Field()
    @IsString()
    @IsNotEmpty()
    @MaxLength(128)
    idempotencyKey!: string;

    @Field(() => [PlaceOrderItemInput])
    @Type(() => PlaceOrderItemInput)
    @ArrayMinSize(1, { message: emptyValue('주문 상품') })
    @ValidateNested({ each: true })
    items!: PlaceOrderItemInput[];
}
