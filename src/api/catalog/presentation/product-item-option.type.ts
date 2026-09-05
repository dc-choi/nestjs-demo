import { Field, ObjectType } from '@nestjs/graphql';

@ObjectType('SelectedProductOption')
export class ProductItemOptionType {
    @Field()
    optionCode!: string;

    @Field()
    optionName!: string;

    @Field()
    valueCode!: string;

    @Field()
    valueName!: string;
}
