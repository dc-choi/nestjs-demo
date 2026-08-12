import { Field, ObjectType } from '@nestjs/graphql';

@ObjectType('SelectedOrderOption')
export class SelectedOrderOptionType {
    @Field()
    optionCode: string;

    @Field()
    optionName: string;

    @Field()
    valueCode: string;

    @Field()
    valueName: string;
}
