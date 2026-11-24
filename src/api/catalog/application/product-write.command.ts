import type { ItemSaleStatus } from '../domain/entity/item-sale-status.js';
import type { ProductStatus } from '../domain/entity/product-status.js';

export interface CreateProductCommand {
    readonly slug: string;
    readonly name: string;
    readonly description?: string | null;
    readonly returnPolicy?: string | null;
    readonly reason?: string | null;
}

export interface ProductRevisionCommand {
    readonly productId: bigint;
    readonly expectedRevision: number;
    readonly reason?: string | null;
}

export interface UpdateProductCommand extends ProductRevisionCommand {
    readonly slug?: string;
    readonly name?: string;
    readonly description?: string | null;
    readonly returnPolicy?: string | null;
    readonly status?: ProductStatus;
}

export type DeleteProductCommand = ProductRevisionCommand;

export interface RestoreProductCommand extends ProductRevisionCommand {
    readonly sourceRevision: number;
}

export interface ReplaceProductCatalogCommand extends ProductRevisionCommand {
    readonly options: readonly ReplaceProductOptionCommand[];
    readonly items: readonly ReplaceProductItemCommand[];
    readonly categoryIds: readonly bigint[];
    readonly tags: readonly string[];
}

export interface CreateProductItemCommand extends ProductRevisionCommand {
    readonly item: Omit<ReplaceProductItemCommand, 'id'> & { readonly id?: never };
}

export interface UpdateProductItemCommand extends ProductRevisionCommand {
    readonly item: ReplaceProductItemCommand & { readonly id: bigint };
}

export interface DeleteProductItemCommand extends ProductRevisionCommand {
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
