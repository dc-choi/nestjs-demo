import { Field, ObjectType } from '@nestjs/graphql';

@ObjectType('ProductSearchThumbnail')
export class ProductSearchThumbnailType {
    @Field()
    url!: string;

    @Field(() => String, { nullable: true })
    altText!: string | null;
}
