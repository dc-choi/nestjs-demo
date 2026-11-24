import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Resolver } from '@nestjs/graphql';

import { ProductCommandService } from '~/api/catalog/application/product-command.service.js';
import type { ProductWriteResult } from '~/api/catalog/application/product-write.command.js';
import { CreateProductItemInput } from '~/api/catalog/presentation/create-product-item.input.js';
import { CreateProductInput } from '~/api/catalog/presentation/create-product.input.js';
import { DeleteProductItemInput } from '~/api/catalog/presentation/delete-product-item.input.js';
import { DeleteProductInput } from '~/api/catalog/presentation/delete-product.input.js';
import { ProductMutationPayload } from '~/api/catalog/presentation/product-mutation.payload.js';
import { ReplaceProductCatalogInput } from '~/api/catalog/presentation/replace-product-catalog.input.js';
import { RestoreProductInput } from '~/api/catalog/presentation/restore-product.input.js';
import { UpdateProductItemInput } from '~/api/catalog/presentation/update-product-item.input.js';
import { UpdateProductInput } from '~/api/catalog/presentation/update-product.input.js';
import { parseGraphqlId } from '~/global/graphql/graphql-id.parser.js';
import { Jwt } from '~/global/jwt/decorator/jwt.decorator.js';
import { SellerGuard } from '~/global/jwt/guard/seller.guard.js';
import type { JwtPayload } from '~/global/jwt/payload/jwt.payload.js';

@Resolver()
export class ProductCommandResolver {
    constructor(private readonly productCommandService: ProductCommandService) {}

    @Mutation(() => ProductMutationPayload)
    @UseGuards(SellerGuard)
    async createProduct(
        @Jwt() actor: JwtPayload,
        @Args('input') input: CreateProductInput
    ): Promise<ProductMutationPayload> {
        return toPayload(await this.productCommandService.create(actor, input));
    }

    @Mutation(() => ProductMutationPayload)
    @UseGuards(SellerGuard)
    async replaceProductCatalog(
        @Jwt() actor: JwtPayload,
        @Args('input') input: ReplaceProductCatalogInput
    ): Promise<ProductMutationPayload> {
        return toPayload(
            await this.productCommandService.replaceCatalog(actor, {
                ...input,
                productId: parseGraphqlId(input.productId, '상품 ID'),
                categoryIds: input.categoryIds.map((id) => parseGraphqlId(id, '카테고리 ID')),
                items: input.items.map((item) => ({
                    ...item,
                    id: item.id ? parseGraphqlId(item.id, 'Item ID') : undefined,
                })),
            })
        );
    }

    @Mutation(() => ProductMutationPayload)
    @UseGuards(SellerGuard)
    async createProductItem(
        @Jwt() actor: JwtPayload,
        @Args('input') input: CreateProductItemInput
    ): Promise<ProductMutationPayload> {
        return toPayload(
            await this.productCommandService.createItem(actor, {
                ...input,
                productId: parseGraphqlId(input.productId, '상품 ID'),
                item: input.item,
            })
        );
    }

    @Mutation(() => ProductMutationPayload)
    @UseGuards(SellerGuard)
    async updateProductItem(
        @Jwt() actor: JwtPayload,
        @Args('input') input: UpdateProductItemInput
    ): Promise<ProductMutationPayload> {
        return toPayload(
            await this.productCommandService.updateItem(actor, {
                ...input,
                productId: parseGraphqlId(input.productId, '상품 ID'),
                item: {
                    ...input.item,
                    id: parseGraphqlId(input.item.id, 'Item ID'),
                },
            })
        );
    }

    @Mutation(() => ProductMutationPayload)
    @UseGuards(SellerGuard)
    async deleteProductItem(
        @Jwt() actor: JwtPayload,
        @Args('input') input: DeleteProductItemInput
    ): Promise<ProductMutationPayload> {
        return toPayload(
            await this.productCommandService.deleteItem(actor, {
                ...input,
                productId: parseGraphqlId(input.productId, '상품 ID'),
                itemId: parseGraphqlId(input.itemId, 'Item ID'),
            })
        );
    }

    @Mutation(() => ProductMutationPayload)
    @UseGuards(SellerGuard)
    async updateProduct(
        @Jwt() actor: JwtPayload,
        @Args('input') input: UpdateProductInput
    ): Promise<ProductMutationPayload> {
        return toPayload(
            await this.productCommandService.update(actor, {
                ...input,
                productId: parseGraphqlId(input.productId, '상품 ID'),
            })
        );
    }

    @Mutation(() => ProductMutationPayload)
    @UseGuards(SellerGuard)
    async deleteProduct(
        @Jwt() actor: JwtPayload,
        @Args('input') input: DeleteProductInput
    ): Promise<ProductMutationPayload> {
        return toPayload(
            await this.productCommandService.delete(actor, {
                ...input,
                productId: parseGraphqlId(input.productId, '상품 ID'),
            })
        );
    }

    @Mutation(() => ProductMutationPayload)
    @UseGuards(SellerGuard)
    async restoreProduct(
        @Jwt() actor: JwtPayload,
        @Args('input') input: RestoreProductInput
    ): Promise<ProductMutationPayload> {
        return toPayload(
            await this.productCommandService.restore(actor, {
                ...input,
                productId: parseGraphqlId(input.productId, '상품 ID'),
            })
        );
    }
}

function toPayload(result: ProductWriteResult): ProductMutationPayload {
    return {
        productId: result.productId.toString(),
        revision: result.revision,
        status: result.status,
        deletedAt: result.deletedAt,
    };
}
