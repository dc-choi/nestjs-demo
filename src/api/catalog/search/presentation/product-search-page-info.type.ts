import { Field, ObjectType } from '@nestjs/graphql';

@ObjectType('ProductSearchPageInfo')
export class ProductSearchPageInfoType {
    @Field()
    hasNextPage!: boolean;

    @Field(() => String, { nullable: true })
    endCursor!: string | null;
}
