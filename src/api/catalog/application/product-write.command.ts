import type { ItemSaleStatus } from '../domain/entity/item-sale-status';
import type { ProductStatus } from '../domain/entity/product-status';

export interface CreateProductCommand {
    readonly slug: string;
    readonly name: string;
    readonly description?: string | null;
    readonly returnPolicy?: string | null;
    readonly reason?: string | null;
}

export interface UpdateProductCommand {
    readonly productId: bigint;
    readonly expectedRevision: number;
    readonly slug?: string;
    readonly name?: string;
    readonly description?: string | null;
    readonly returnPolicy?: string | null;
    readonly status?: ProductStatus;
    readonly reason?: string | null;
}

export interface DeleteProductCommand {
    readonly productId: bigint;
    readonly expectedRevision: number;
    readonly reason?: string | null;
}

export interface RestoreProductCommand extends DeleteProductCommand {
    readonly sourceRevision: number;
}

export interface ReplaceProductCatalogCommand extends DeleteProductCommand {
    readonly options: readonly ReplaceProductOptionCommand[];
    readonly items: readonly ReplaceProductItemCommand[];
    readonly categoryIds: readonly bigint[];
    readonly tags: readonly string[];
}

export interface CreateProductItemCommand extends DeleteProductCommand {
    readonly item: ReplaceProductItemCommand;
}

export interface UpdateProductItemCommand extends DeleteProductCommand {
    readonly item: ReplaceProductItemCommand & { readonly id: bigint };
}

export interface DeleteProductItemCommand extends DeleteProductCommand {
    readonly itemId: bigint;
}

export interface ReplaceProductOptionCommand {
    readonly code: string;
    readonly name: string;
    readonly isRequired: boolean;
    readonly values: readonly ReplaceProductOptionValueCommand[];
}

export interface ReplaceProductOptionValueCommand {
    readonly code: string;
    readonly name: string;
}

export interface ReplaceProductItemCommand {
    readonly id?: bigint;
    readonly sku?: string | null;
    readonly name: string;
    readonly supplyPrice: string;
    readonly vat: string;
    readonly isTaxFree: boolean;
    readonly saleStatus: ItemSaleStatus;
    readonly selectedOptions: readonly ReplaceProductItemOptionCommand[];
}

export interface ReplaceProductItemOptionCommand {
    readonly optionCode: string;
    readonly valueCode: string;
}

export interface ProductWriteResult {
    readonly productId: bigint;
    readonly revision: number;
    readonly status: ProductStatus;
    readonly deletedAt: Date | null;
}
