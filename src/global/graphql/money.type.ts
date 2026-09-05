import { Field, ObjectType } from '@nestjs/graphql';

@ObjectType('Money')
export class MoneyType {
    @Field()
    amount!: string;

    @Field()
    currencyCode!: string;
}
