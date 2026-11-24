import { BadRequestException, Logger, ServiceUnavailableException } from '@nestjs/common';
import { Args, Query, Resolver } from '@nestjs/graphql';

import { PRODUCT_CURRENCY_CODE } from '~/api/catalog/domain/product.rules.js';
import { ProductSearchCursorError } from '~/api/search/application/product-search-cursor.error.js';
import { ProductSearchUnavailableError } from '~/api/search/application/product-search-unavailable.error.js';
import { ProductSearchConnection, ProductSearchService } from '~/api/search/application/product-search.service.js';
import { ProductSearchInputError } from '~/api/search/domain/product-search-input.error.js';
import { ProductSearchConnectionType } from '~/api/search/presentation/product-search-connection.type.js';
import { ProductSearchInputType } from '~/api/search/presentation/product-search.input.js';
import { getCurrentRequestId } from '~/global/common/context/request-context.js';
import { formatMoneyAmount } from '~/global/graphql/money-amount.js';

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
            if (error instanceof ProductSearchInputError || error instanceof ProductSearchCursorError) {
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
        nodes: connection.nodes.map(({ price, ...node }) => ({
            ...node,
            price: { amount: formatMoneyAmount(price.toFixed(3)), currencyCode: PRODUCT_CURRENCY_CODE },
            // No media delivery layer turns the indexed storage key into a public URL yet.
            thumbnail: null,
        })),
        pageInfo: { ...connection.pageInfo },
    };
}
