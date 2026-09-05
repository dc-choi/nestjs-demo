import { BadRequestException, Logger, ServiceUnavailableException } from '@nestjs/common';
import { Args, Query, Resolver } from '@nestjs/graphql';

import {
    ProductSearchConnection,
    ProductSearchUnavailableError,
} from '~/api/catalog/search/application/product-search.port';
import { ProductSearchService } from '~/api/catalog/search/application/product-search.service';
import { ProductSearchContractError } from '~/api/catalog/search/domain/product-search.query';
import { ProductSearchInputType } from '~/api/catalog/search/presentation/product-search.input';
import { ProductSearchConnectionType } from '~/api/catalog/search/presentation/product-search.type';
import { getCurrentRequestId } from '~/global/common/context/request-context';

@Resolver(() => ProductSearchConnectionType)
export class ProductSearchResolver {
    private readonly logger = new Logger(ProductSearchResolver.name);

    constructor(private readonly productSearchService: ProductSearchService) {}

    @Query(() => ProductSearchConnectionType, {
        name: 'searchProducts',
        nullable: true,
        description: 'OpenSearch 기반 현재 판매 상품 검색',
    })
    async searchProducts(@Args('input') input: ProductSearchInputType): Promise<ProductSearchConnectionType> {
        try {
            return toProductSearchConnectionType(await this.productSearchService.search(input));
        } catch (error) {
            if (error instanceof ProductSearchContractError) {
                throw new BadRequestException({ type: error.code, message: error.message });
            }
            if (error instanceof ProductSearchUnavailableError) {
                throw new ServiceUnavailableException({ type: error.code, message: error.message });
            }
            this.logger.error({ type: 'PRODUCT SEARCH FAILURE', requestId: getCurrentRequestId() ?? 'unknown' });
            throw new ServiceUnavailableException({
                type: 'SEARCH_UNAVAILABLE',
                message: 'Product search is temporarily unavailable',
            });
        }
    }
}

function toProductSearchConnectionType(connection: ProductSearchConnection): ProductSearchConnectionType {
    return {
        nodes: connection.nodes.map((node) => ({ ...node })),
        pageInfo: { ...connection.pageInfo },
    };
}
