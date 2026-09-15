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

/** A Product scalar rule was violated. */
export class ProductRuleError extends Error {}

type RuleViolation = (message: string) => Error;

const productRuleViolation: RuleViolation = (message) => new ProductRuleError(message);

/**
 * Trims a required text and enforces its length. CatalogGraph shares this rule for option, item and
 * tag names but reports violations as its own error type, hence the optional error factory.
 */
export function normalizeRequiredText(
    value: string,
    field: string,
    maxLength: number,
    violation: RuleViolation = productRuleViolation
): string {
    if (typeof value !== 'string') throw violation(`${field}이(가) 문자열이어야 합니다.`);

    const normalized = value.trim();
    if (!normalized || normalized.length > maxLength) throw violation(`${field}의 길이가 올바르지 않습니다.`);

    return normalized;
}

/** Trims an optional long text; blank input becomes null. */
export function normalizeNullableText(value: string | null | undefined, field: string): string | null {
    if (value === null || value === undefined) return null;
    if (typeof value !== 'string') throw new ProductRuleError(`${field}이(가) 문자열이어야 합니다.`);

    const normalized = value.trim();
    if (normalized.length > PRODUCT_TEXT_MAX_LENGTH) throw new ProductRuleError(`${field}이(가) 너무 깁니다.`);

    return normalized || null;
}

export function normalizeSlug(value: string): string {
    const slug = normalizeRequiredText(value, '상품 slug', PRODUCT_SLUG_MAX_LENGTH);
    if (!PRODUCT_SLUG_PATTERN.test(slug)) throw new ProductRuleError('상품 slug가 올바르지 않습니다.');
    return slug;
}
