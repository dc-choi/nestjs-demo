export const PRODUCT_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const PRODUCT_SLUG_MAX_LENGTH = 255;
export const PRODUCT_NAME_MAX_LENGTH = 255;
export const PRODUCT_REASON_MAX_LENGTH = 500;
export const PRODUCT_TEXT_MAX_LENGTH = 65_535;
export const PRODUCT_OPTION_CODE_PATTERN = /^[a-z0-9]+(?:[_-][a-z0-9]+)*$/;
export const PRODUCT_OPTION_CODE_MAX_LENGTH = 64;
export const PRODUCT_ITEM_SKU_MAX_LENGTH = 255;
export const PRODUCT_TAG_MAX_LENGTH = 64;
export const PRODUCT_PRICE_PATTERN = /^(0|[1-9]\d{0,6})(?:\.\d{1,3})?$/;

export const PRODUCT_CATALOG_LIMITS = {
    options: 10,
    optionValues: 50,
    items: 500,
    categories: 20,
    tags: 50,
} as const;
