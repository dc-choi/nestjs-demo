import {
    CATALOG_SEARCH_SCHEMA_VERSION,
    CatalogCategoryProjectionSource,
    CatalogProductProjectionSource,
    MAX_PRODUCT_REVISION,
    MAX_SEARCHABLE_ITEMS_PER_PRODUCT,
    ProductSearchDocument,
    ProductSearchItemDocument,
} from './product-search.document';

const CODE_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const DECIMAL_PATTERN = /^(?:0|[1-9]\d{0,6})(?:\.\d{1,3})?$/;
const MAX_SIGNED_BIGINT = 9_223_372_036_854_775_807n;

export class CatalogProjectionError extends Error {
    constructor(message: string) {
        super(message);
        this.name = CatalogProjectionError.name;
    }
}

export function projectCatalogProduct(source: CatalogProductProjectionSource): ProductSearchDocument | null {
    validateProductIdentity(source);
    if (source.status !== 'ACTIVE' || source.deletedAt !== null) return null;

    const searchableItems = source.items
        .filter(({ saleStatus, deletedAt }) => saleStatus === 'ALLOW' && deletedAt === null)
        .toSorted((left, right) => left.sequence - right.sequence || compareBigInt(left.id, right.id));

    if (searchableItems.length === 0) return null;
    if (searchableItems.length > MAX_SEARCHABLE_ITEMS_PER_PRODUCT) {
        throw new CatalogProjectionError(
            `Product ${source.id} has ${searchableItems.length} searchable items; maximum is ${MAX_SEARCHABLE_ITEMS_PER_PRODUCT}`
        );
    }

    const items = searchableItems.map(projectItem);
    const categories = source.categories
        .filter(({ isActive, deletedAt }) => isActive && deletedAt === null)
        .toSorted((left, right) => left.sequence - right.sequence || compareBigInt(left.id, right.id));
    const thumbnail = source.media
        .filter(({ role }) => role === 'THUMBNAIL')
        .toSorted((left, right) => left.sequence - right.sequence || compareBigInt(left.id, right.id))[0];
    const prices = items.map(({ totalPrice }) => totalPrice);

    return {
        schemaVersion: CATALOG_SEARCH_SCHEMA_VERSION,
        productId: toId(source.id, 'productId'),
        productRevision: source.revision,
        sellerId: toId(source.sellerId, 'sellerId'),
        slug: source.slug,
        updatedAt: source.updatedAt.toISOString(),
        name: source.name,
        description: source.description ?? '',
        tags: source.tags
            .toSorted((left, right) => left.sequence - right.sequence || left.value.localeCompare(right.value))
            .map(({ value }) => value),
        categoryIds: categories.map(({ id }) => toId(id, 'categoryId')),
        categorySlugs: categories.map(({ slug }) => slug),
        categoryNames: categories.map(({ name }) => name),
        categoryAncestorSlugs: collectAncestorSlugs(categories),
        thumbnail: thumbnail ? { storageKey: thumbnail.storageKey, altText: thumbnail.altText } : null,
        minPrice: Math.min(...prices),
        maxPrice: Math.max(...prices),
        items,
    };
}

function validateProductIdentity(source: CatalogProductProjectionSource): void {
    toId(source.id, 'productId');
    toId(source.sellerId, 'sellerId');
    if (!Number.isInteger(source.revision) || source.revision < 1 || source.revision > MAX_PRODUCT_REVISION) {
        throw new CatalogProjectionError(`Product ${source.id} has invalid revision ${source.revision}`);
    }
    if (Number.isNaN(source.updatedAt.getTime())) {
        throw new CatalogProjectionError(`Product ${source.id} has an invalid updatedAt value`);
    }
}

function projectItem(item: CatalogProductProjectionSource['items'][number]): ProductSearchItemDocument {
    if (!Number.isInteger(item.sequence) || item.sequence < 0) {
        throw new CatalogProjectionError(`Item ${item.id} has invalid sequence ${item.sequence}`);
    }

    const seenOptions = new Set<string>();
    const optionTokens = item.options
        .toSorted((left, right) => left.sequence - right.sequence || left.optionCode.localeCompare(right.optionCode))
        .map(({ optionCode, valueCode }) => {
            if (!CODE_PATTERN.test(optionCode) || !CODE_PATTERN.test(valueCode)) {
                throw new CatalogProjectionError(`Item ${item.id} has an invalid option code`);
            }
            if (seenOptions.has(optionCode)) {
                throw new CatalogProjectionError(`Item ${item.id} contains duplicate option ${optionCode}`);
            }
            seenOptions.add(optionCode);
            return `${optionCode}:${valueCode}`;
        });

    return {
        itemId: toId(item.id, 'itemId'),
        sku: item.sku,
        name: item.name,
        sequence: item.sequence,
        totalPrice: parsePrice(item.totalPrice, item.id),
        isTaxFree: item.isTaxFree,
        optionTokens,
    };
}

function parsePrice(value: string, itemId: bigint): number {
    if (!DECIMAL_PATTERN.test(value)) {
        throw new CatalogProjectionError(`Item ${itemId} has invalid totalPrice ${value}`);
    }
    return Number(value);
}

function collectAncestorSlugs(categories: CatalogCategoryProjectionSource[]): string[] {
    const slugs = new Set<string>();
    for (const category of categories) {
        for (const slug of category.ancestorSlugs) slugs.add(slug);
    }
    return [...slugs];
}

function toId(value: bigint, field: string): string {
    if (value < 1n || value > MAX_SIGNED_BIGINT) throw new CatalogProjectionError(`${field} is outside signed BIGINT`);
    return value.toString();
}

function compareBigInt(left: bigint, right: bigint): number {
    if (left === right) return 0;
    return left < right ? -1 : 1;
}
