import { Args, ID, Query, Resolver } from '@nestjs/graphql';

import { ProductService } from '~/api/catalog/application/product.service';
import { parseProductId } from '~/api/catalog/presentation/product-id.parser';
import { toProductType } from '~/api/catalog/presentation/product.mapper';
import { ProductType } from '~/api/catalog/presentation/product.type';

@Resolver(() => ProductType)
export class ProductResolver {
    constructor(private readonly productService: ProductService) {}

    @Query(() => ProductType, {
        name: 'product',
        nullable: true,
        description: '현재 판매 상품 조회',
    })
    async product(@Args('id', { type: () => ID }) id: string): Promise<ProductType | null> {
        const product = await this.productService.findCurrentById(parseProductId(id));

        return product ? toProductType(product) : null;
    }
}
