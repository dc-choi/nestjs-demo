import { Field, InputType } from '@nestjs/graphql';

import { CreateProductItemDataInput } from './create-product-item-data.input';
import { ProductItemWriteInput } from './product-item-write.input';

import { Type } from 'class-transformer';
import { ValidateNested } from 'class-validator';

@InputType()
export class CreateProductItemInput extends ProductItemWriteInput {
    @Field(() => CreateProductItemDataInput)
    @Type(() => CreateProductItemDataInput)
    @ValidateNested()
    item!: CreateProductItemDataInput;
}
