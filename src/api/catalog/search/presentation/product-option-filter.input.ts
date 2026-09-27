import { Field, InputType } from '@nestjs/graphql';

@InputType('ProductOptionFilterInput')
export class ProductOptionFilterInput {
    @Field()
    optionCode!: string;

    @Field()
    valueCode!: string;
}
