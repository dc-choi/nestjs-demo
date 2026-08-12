import { Args, ID, Query, Resolver } from '@nestjs/graphql';

import { GetProductQuery } from '~/api/catalog/application/get-product.query';
import { parseProductId } from '~/api/catalog/presentation/product-id.parser';
import { toProductType } from '~/api/catalog/presentation/product.mapper';
import { ProductType } from '~/api/catalog/presentation/product.type';

@Resolver(() => ProductType)
export class ProductResolver {
    constructor(private readonly getProductQuery: GetProductQuery) {}

    @Query(() => ProductType, {
        name: 'product',
        nullable: true,
        description: '현재 공개된 상품 버전 조회',
    })
    async product(@Args('id', { type: () => ID }) id: string): Promise<ProductType | null> {
        const product = await this.getProductQuery.execute(parseProductId(id));

        return product ? toProductType(product) : null;
    }
}
