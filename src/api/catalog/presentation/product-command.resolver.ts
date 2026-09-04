import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Resolver } from '@nestjs/graphql';

import { ProductCommandService } from '~/api/catalog/application/product-command.service';
import type { ProductWriteResult } from '~/api/catalog/application/product-write.command';
import { CreateProductInput } from '~/api/catalog/presentation/create-product.input';
import { DeleteProductItemInput } from '~/api/catalog/presentation/delete-product-item.input';
import { DeleteProductInput } from '~/api/catalog/presentation/delete-product.input';
import { parseCatalogId, parseProductId } from '~/api/catalog/presentation/product-id.parser';
import { ProductMutationPayload } from '~/api/catalog/presentation/product-mutation.payload';
import {
    ReplaceProductCatalogInput,
    ReplaceProductItemInput,
} from '~/api/catalog/presentation/replace-product-catalog.input';
import { RestoreProductInput } from '~/api/catalog/presentation/restore-product.input';
import { UpdateProductInput } from '~/api/catalog/presentation/update-product.input';
import { WriteProductItemInput } from '~/api/catalog/presentation/write-product-item.input';
import { Jwt } from '~/global/jwt/decorator/jwt.decorator';
import { SellerGuard } from '~/global/jwt/guard/seller.guard';
import type { JwtPayload } from '~/global/jwt/payload/jwt.payload';

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
                productId: parseProductId(input.productId),
                categoryIds: input.categoryIds.map((id) => parseCatalogId(id, '카테고리 ID')),
                items: input.items.map((item) => ({
                    ...item,
                    id: item.id ? parseCatalogId(item.id, 'Item ID') : undefined,
                })),
            })
        );
    }

    @Mutation(() => ProductMutationPayload)
    @UseGuards(SellerGuard)
    async createProductItem(
        @Jwt() actor: JwtPayload,
        @Args('input') input: WriteProductItemInput
    ): Promise<ProductMutationPayload> {
        return toPayload(
            await this.productCommandService.createItem(actor, {
                ...input,
                productId: parseProductId(input.productId),
                item: toItemCommand(input.item),
            })
        );
    }

    @Mutation(() => ProductMutationPayload)
    @UseGuards(SellerGuard)
    async updateProductItem(
        @Jwt() actor: JwtPayload,
        @Args('input') input: WriteProductItemInput
    ): Promise<ProductMutationPayload> {
        return toPayload(
            await this.productCommandService.updateItem(actor, {
                ...input,
                productId: parseProductId(input.productId),
                item: {
                    ...input.item,
                    id: parseCatalogId(input.item.id ?? '', 'Item ID'),
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
                productId: parseProductId(input.productId),
                itemId: parseCatalogId(input.itemId, 'Item ID'),
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
                productId: parseProductId(input.productId),
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
                productId: parseProductId(input.productId),
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
                productId: parseProductId(input.productId),
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

function toItemCommand(item: ReplaceProductItemInput) {
    return {
        ...item,
        id: item.id ? parseCatalogId(item.id, 'Item ID') : undefined,
    };
}
