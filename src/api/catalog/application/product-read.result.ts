export interface ProductReadResult {
    id: bigint;
    slug: string;
    revision: number;
    name: string;
    description: string | null;
    returnPolicy: string | null;
    updatedAt: Date;
    items: ProductItemReadResult[];
    options: ProductOptionReadResult[];
    categories: ProductCategoryReadResult[];
    tags: string[];
}

export interface ProductItemReadResult {
    id: bigint;
    sku: string;
    name: string;
    price: ProductPriceReadResult;
    isTaxFree: boolean;
    sequence: number;
    selectedOptions: ProductItemOptionReadResult[];
}

export interface ProductPriceReadResult {
    amount: string;
    currencyCode: 'KRW';
}

export interface ProductItemOptionReadResult {
    optionCode: string;
    optionName: string;
    valueCode: string;
    valueName: string;
}

export interface ProductOptionReadResult {
    id: bigint;
    code: string;
    name: string;
    isRequired: boolean;
    sequence: number;
    values: ProductOptionValueReadResult[];
}

export interface ProductOptionValueReadResult {
    id: bigint;
    code: string;
    name: string;
    sequence: number;
}

export interface ProductCategoryReadResult {
    id: bigint;
    name: string;
    slug: string;
    sequence: number;
}
