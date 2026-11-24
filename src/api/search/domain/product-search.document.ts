export const CATALOG_SEARCH_SCHEMA_VERSION = 1;
export const MAX_SEARCHABLE_ITEMS_PER_PRODUCT = 100;
export const MAX_PRODUCT_REVISION = 2_147_483_647;

export interface ProductSearchDocument {
    schemaVersion: typeof CATALOG_SEARCH_SCHEMA_VERSION;
    productId: string;
    productRevision: number;
    sellerId: string;
    slug: string;
    updatedAt: string;
    name: string;
    description: string;
    tags: string[];
    categoryIds: string[];
    categorySlugs: string[];
    categoryNames: string[];
    categoryAncestorSlugs: string[];
    thumbnail: ProductSearchThumbnailDocument | null;
    minPrice: number;
    maxPrice: number;
    items: ProductSearchItemDocument[];
}

export interface ProductSearchThumbnailDocument {
    storageKey: string;
    altText: string | null;
}

export interface ProductSearchItemDocument {
    itemId: string;
    sku: string;
    name: string;
    sequence: number;
    totalPrice: number;
    isTaxFree: boolean;
    optionTokens: string[];
}

export interface CatalogProductProjectionSource {
    id: bigint;
    revision: number;
    sellerId: bigint;
    slug: string;
    name: string;
    description: string | null;
    status: string;
    updatedAt: Date;
    deletedAt: Date | null;
    items: CatalogItemProjectionSource[];
    categories: CatalogCategoryProjectionSource[];
    tags: CatalogTagProjectionSource[];
    media: CatalogMediaProjectionSource[];
}

export interface CatalogItemProjectionSource {
    id: bigint;
    sku: string;
    name: string;
    totalPrice: string;
    isTaxFree: boolean;
    saleStatus: string;
    sequence: number;
    deletedAt: Date | null;
    options: CatalogItemOptionProjectionSource[];
}

export interface CatalogItemOptionProjectionSource {
    optionCode: string;
    valueCode: string;
    sequence: number;
}

export interface CatalogCategoryProjectionSource {
    id: bigint;
    name: string;
    slug: string;
    sequence: number;
    ancestorSlugs: string[];
    isActive: boolean;
    deletedAt: Date | null;
}

export interface CatalogTagProjectionSource {
    value: string;
    sequence: number;
}

export interface CatalogMediaProjectionSource {
    id: bigint;
    role: string;
    storageKey: string;
    altText: string | null;
    sequence: number;
}
