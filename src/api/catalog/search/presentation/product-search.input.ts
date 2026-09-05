import { Field, InputType, Int, registerEnumType } from '@nestjs/graphql';

import { DecimalScalar } from './decimal.scalar';

import { ProductSearchSort } from '~/api/catalog/search/domain/product-search.query';

registerEnumType(ProductSearchSort, { name: 'ProductSearchSort' });

@InputType('ProductOptionFilterInput')
export class ProductOptionFilterInput {
    @Field()
    optionCode!: string;

    @Field()
    valueCode!: string;
}

@InputType('ProductSearchInput')
export class ProductSearchInputType {
    @Field({ nullable: true })
    query?: string;

    @Field({ nullable: true })
    categorySlug?: string;

    @Field(() => DecimalScalar, { nullable: true })
    minPrice?: string;

    @Field(() => DecimalScalar, { nullable: true })
    maxPrice?: string;

    @Field({ nullable: true })
    sku?: string;

    @Field(() => [ProductOptionFilterInput], { nullable: true })
    options?: ProductOptionFilterInput[];

    @Field(() => ProductSearchSort, { defaultValue: ProductSearchSort.RELEVANCE })
    sort?: ProductSearchSort;

    @Field(() => Int, { defaultValue: 20 })
    first?: number;

    @Field({ nullable: true })
    after?: string;
}
