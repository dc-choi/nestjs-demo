import { Field, InputType } from '@nestjs/graphql';

import { ProductItemWriteInput } from './product-item-write.input';
import { UpdateProductItemDataInput } from './update-product-item-data.input';

import { Type } from 'class-transformer';
import { ValidateNested } from 'class-validator';

@InputType()
export class UpdateProductItemInput extends ProductItemWriteInput {
    @Field(() => UpdateProductItemDataInput)
    @Type(() => UpdateProductItemDataInput)
    @ValidateNested()
    item!: UpdateProductItemDataInput;
}
