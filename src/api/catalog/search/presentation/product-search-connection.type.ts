import { Field, ObjectType } from '@nestjs/graphql';

import { ProductSearchNodeType } from './product-search-node.type';
import { ProductSearchPageInfoType } from './product-search-page-info.type';

@ObjectType('ProductSearchConnection')
export class ProductSearchConnectionType {
    @Field(() => [ProductSearchNodeType])
    nodes!: ProductSearchNodeType[];

    @Field(() => ProductSearchPageInfoType)
    pageInfo!: ProductSearchPageInfoType;
}
