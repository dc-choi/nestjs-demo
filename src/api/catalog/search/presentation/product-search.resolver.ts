import { Args, Query, Resolver } from '@nestjs/graphql';

import { ProductSearchService } from '~/api/catalog/search/application/product-search.service';
import { ProductSearchInputType } from '~/api/catalog/search/presentation/product-search.input';
import { ProductSearchConnectionType } from '~/api/catalog/search/presentation/product-search.type';

@Resolver(() => ProductSearchConnectionType)
export class ProductSearchResolver {
    constructor(private readonly productSearchService: ProductSearchService) {}

    @Query(() => ProductSearchConnectionType, {
        name: 'searchProducts',
        nullable: true,
        description: 'OpenSearch 기반 현재 판매 상품 검색',
    })
    searchProducts(@Args('input') input: ProductSearchInputType): Promise<ProductSearchConnectionType> {
        return this.productSearchService.search(input);
    }
}
