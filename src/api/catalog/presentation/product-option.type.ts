import { Field, ID, Int, ObjectType } from '@nestjs/graphql';

import { ProductOptionValueType } from './product-option-value.type';

@ObjectType('ProductOption')
export class ProductOptionType {
    @Field(() => ID)
    id!: string;

    @Field()
    code!: string;

    @Field()
    name!: string;

    @Field()
    isRequired!: boolean;

    @Field(() => Int)
    sequence!: number;

    @Field(() => [ProductOptionValueType])
    values!: ProductOptionValueType[];
}
