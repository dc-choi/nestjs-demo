import type { ItemSaleStatus } from './item-sale-status';
import type { ProductMediaRole } from './product-media-role';
import type { ProductStatus } from './product-status';

export interface ProductSnapshotPayload {
    product: {
        id: string;
        sellerId: string;
        slug: string;
        name: string;
        description: string | null;
        returnPolicy: string | null;
        status: ProductStatus;
    };
    items: ProductSnapshotItemPayload[];
    options: ProductSnapshotOptionPayload[];
    categories: ProductSnapshotCategoryPayload[];
    media: ProductSnapshotMediaPayload[];
    tags: ProductSnapshotTagPayload[];
}

export interface ProductSnapshotItemPayload {
    id: string;
    sku: string;
    name: string;
    supplyPrice: string;
    vat: string;
    totalPrice: string;
    isTaxFree: boolean;
    saleStatus: ItemSaleStatus;
    sequence: number;
    optionSignature: string;
    selectedOptions: Array<{
        optionId: string;
        optionCode: string;
        optionName: string;
        valueId: string;
        valueCode: string;
        valueName: string;
    }>;
}

export interface ProductSnapshotOptionPayload {
    id: string;
    code: string;
    name: string;
    isRequired: boolean;
    sequence: number;
    values: Array<{
        id: string;
        code: string;
        name: string;
        sequence: number;
    }>;
}

export interface ProductSnapshotCategoryPayload {
    id: string;
    name: string;
    slug: string;
    sequence: number;
    path: Array<{ id: string; name: string; slug: string }>;
}

export interface ProductSnapshotMediaPayload {
    id: string;
    role: ProductMediaRole;
    altText: string | null;
    sequence: number;
    asset: {
        id: string;
        storageKey: string;
        originalName: string | null;
        mimeType: string;
        byteSize: string;
        checksum: string;
        width: number | null;
        height: number | null;
    };
}

export interface ProductSnapshotTagPayload {
    value: string;
    sequence: number;
}
