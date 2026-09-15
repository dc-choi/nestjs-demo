import { Args, ID, Query, Resolver } from '@nestjs/graphql';

import { ProductService } from '~/api/catalog/application/product.service';
import { toProductType } from '~/api/catalog/presentation/product.mapper';
import { ProductType } from '~/api/catalog/presentation/product.type';
import { parseGraphqlId } from '~/global/graphql/graphql-id.parser';

@Resolver(() => ProductType)
export class ProductResolver {
    constructor(private readonly productService: ProductService) {}

    @Query(() => ProductType, {
        name: 'product',
        nullable: true,
        description: '현재 판매 상품 조회',
    })
    async product(@Args('id', { type: () => ID }) id: string): Promise<ProductType | null> {
        const product = await this.productService.findCurrentById(parseGraphqlId(id, '상품 ID'));

        return product ? toProductType(product) : null;
    }
}
