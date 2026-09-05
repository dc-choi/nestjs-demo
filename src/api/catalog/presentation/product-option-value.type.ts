import { Field, ID, Int, ObjectType } from '@nestjs/graphql';

@ObjectType('ProductOptionValue')
export class ProductOptionValueType {
    @Field(() => ID)
    id!: string;

    @Field()
    code!: string;

    @Field()
    name!: string;

    @Field(() => Int)
    sequence!: number;
}
