import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const ProductSearchSort = {
    RELEVANCE: 'RELEVANCE',
    PRICE_ASC: 'PRICE_ASC',
    PRICE_DESC: 'PRICE_DESC',
} as const;

export type ProductSearchSort = (typeof ProductSearchSort)[keyof typeof ProductSearchSort];

export interface ProductOptionFilter {
    optionCode: string;
    valueCode: string;
}

export interface ProductSearchInput {
    query?: string | null;
    categorySlug?: string | null;
    minPrice?: string | null;
    maxPrice?: string | null;
    sku?: string | null;
    options?: ProductOptionFilter[] | null;
    sort?: ProductSearchSort | null;
    first?: number | null;
    after?: string | null;
}

export interface CanonicalProductSearchInput {
    query: string | null;
    categorySlug: string | null;
    minPrice: string | null;
    maxPrice: string | null;
    sku: string | null;
    options: ProductOptionFilter[];
    sort: ProductSearchSort;
    first: number;
}

export type SearchSortValue = string | number | null;

export interface DecodedSearchCursor {
    pitId: string;
    sortValues: SearchSortValue[];
    fingerprint: string;
}

export class ProductSearchContractError extends Error {
    constructor(
        readonly code:
            | 'INVALID_SEARCH_INPUT'
            | 'INVALID_SEARCH_CURSOR'
            | 'SEARCH_CURSOR_EXPIRED'
            | 'SEARCH_CURSOR_MISMATCH',
        message: string
    ) {
        super(message);
        this.name = ProductSearchContractError.name;
    }
}

const OPTION_CODE_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const CATEGORY_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,253}[a-z0-9])?$/;
const SKU_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/;
const PRICE_PATTERN = /^(?:0|[1-9]\d{0,6})(?:\.\d{1,3})?$/;
const VALID_SORTS = new Set<ProductSearchSort>(Object.values(ProductSearchSort));
const CURSOR_VERSION = 1;
const CURSOR_TTL_MS = 60_000;
const MAX_CURSOR_LENGTH = 8_192;
const MAX_OPTION_FILTERS = 20;

interface SearchCursorPayload {
    v: number;
    p: string;
    s: SearchSortValue[];
    f: string;
    e: number;
}

export function canonicalizeProductSearchInput(input: ProductSearchInput): CanonicalProductSearchInput {
    const query = normalizeQuery(input.query);
    const categorySlug = normalizeKeyword(input.categorySlug, CATEGORY_SLUG_PATTERN, 'categorySlug');
    const sku = normalizeKeyword(input.sku, SKU_PATTERN, 'sku');
    const minPrice = normalizePrice(input.minPrice, 'minPrice');
    const maxPrice = normalizePrice(input.maxPrice, 'maxPrice');
    if (minPrice !== null && maxPrice !== null && toScaledPrice(minPrice) > toScaledPrice(maxPrice)) {
        invalidInput('minPrice must not exceed maxPrice');
    }

    const sort = input.sort ?? ProductSearchSort.RELEVANCE;
    if (!VALID_SORTS.has(sort)) invalidInput('Unsupported product search sort');
    const first = input.first ?? 20;
    if (!Number.isInteger(first) || first < 1 || first > 50) invalidInput('first must be between 1 and 50');

    const sourceOptions = input.options ?? [];
    if (sourceOptions.length > MAX_OPTION_FILTERS)
        invalidInput(`options must not contain more than ${MAX_OPTION_FILTERS} entries`);
    const seenOptions = new Set<string>();
    const options = sourceOptions.map(({ optionCode, valueCode }) => {
        const normalizedOption = normalizeRequiredCode(optionCode, 'optionCode');
        if (seenOptions.has(normalizedOption)) invalidInput(`Duplicate optionCode: ${normalizedOption}`);
        seenOptions.add(normalizedOption);
        return { optionCode: normalizedOption, valueCode: normalizeRequiredCode(valueCode, 'valueCode') };
    });
    options.sort(
        (left, right) =>
            left.optionCode.localeCompare(right.optionCode) || left.valueCode.localeCompare(right.valueCode)
    );

    return { query, categorySlug, minPrice, maxPrice, sku, options, sort, first };
}

export function fingerprintProductSearchInput(input: CanonicalProductSearchInput): string {
    return createHash('sha256').update(JSON.stringify(input)).digest('base64url');
}

export function encodeSearchCursor(
    pitId: string,
    sortValues: SearchSortValue[],
    fingerprint: string,
    secret: string,
    now = Date.now()
): string {
    const payload: SearchCursorPayload = {
        v: CURSOR_VERSION,
        p: pitId,
        s: sortValues,
        f: fingerprint,
        e: now + CURSOR_TTL_MS,
    };
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = signCursor(encoded, secret);
    return `${encoded}.${signature}`;
}

export function decodeSearchCursor(cursor: string, secret: string, now = Date.now()): DecodedSearchCursor {
    if (cursor.length > MAX_CURSOR_LENGTH) invalidCursor();
    const parts = cursor.split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]) invalidCursor();
    const [encoded, signature] = parts as [string, string];
    const expected = signCursor(encoded, secret);
    const suppliedBytes = Buffer.from(signature, 'base64url');
    const expectedBytes = Buffer.from(expected, 'base64url');
    if (suppliedBytes.length !== expectedBytes.length || !timingSafeEqual(suppliedBytes, expectedBytes))
        invalidCursor();

    let payload: unknown;
    try {
        payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    } catch {
        invalidCursor();
    }
    if (!isSearchCursorPayload(payload)) invalidCursor();
    if (payload.e <= now) {
        throw new ProductSearchContractError('SEARCH_CURSOR_EXPIRED', 'Search cursor has expired');
    }
    return { pitId: payload.p, sortValues: payload.s, fingerprint: payload.f };
}

export function assertSearchCursorFingerprint(cursor: DecodedSearchCursor, fingerprint: string): void {
    if (cursor.fingerprint !== fingerprint) {
        throw new ProductSearchContractError(
            'SEARCH_CURSOR_MISMATCH',
            'Search cursor does not match the current search input'
        );
    }
}

export function buildProductSearchRequest(
    input: CanonicalProductSearchInput,
    pitId: string,
    searchAfter?: SearchSortValue[]
): Record<string, unknown> {
    const itemFilters = buildItemFilters(input);
    const itemQuery = itemFilters.length > 0 ? { bool: { filter: itemFilters } } : { match_all: {} };
    const rootFilters: unknown[] = [
        {
            nested: {
                path: 'items',
                score_mode: 'none',
                query: itemQuery,
                inner_hits: {
                    name: 'selected_item',
                    size: 1,
                    _source: true,
                    sort: buildInnerItemSort(input.sort),
                },
            },
        },
    ];
    if (input.categorySlug !== null) {
        rootFilters.unshift({ term: { categoryAncestorSlugs: input.categorySlug } });
    }

    const must = input.query
        ? [
              {
                  multi_match: {
                      query: input.query,
                      fields: ['name^4', 'tags^2', 'description'],
                      type: 'best_fields',
                  },
              },
          ]
        : [];

    return {
        size: input.first + 1,
        track_total_hits: false,
        pit: { id: pitId, keep_alive: '1m' },
        query: { bool: { must, filter: rootFilters } },
        sort: buildRootSort(input),
        ...(searchAfter ? { search_after: searchAfter } : {}),
        _source: ['productId', 'slug', 'name'],
    };
}

function buildInnerItemSort(sort: ProductSearchSort): unknown[] {
    const common = [{ 'items.sequence': 'asc' }, { 'items.itemId': 'asc' }];
    if (sort === ProductSearchSort.PRICE_ASC) return [{ 'items.totalPrice': 'asc' }, ...common];
    if (sort === ProductSearchSort.PRICE_DESC) return [{ 'items.totalPrice': 'desc' }, ...common];
    return common;
}

function buildRootSort(input: CanonicalProductSearchInput): unknown[] {
    if (input.sort === ProductSearchSort.PRICE_ASC || input.sort === ProductSearchSort.PRICE_DESC) {
        const order = input.sort === ProductSearchSort.PRICE_ASC ? 'asc' : 'desc';
        return [
            {
                'items.totalPrice': {
                    order,
                    mode: order === 'asc' ? 'min' : 'max',
                    nested: { path: 'items', filter: buildNestedSortFilter(input) },
                },
            },
            { productId: 'asc' },
        ];
    }
    return input.query
        ? [{ _score: 'desc' }, { updatedAt: 'desc' }, { productId: 'asc' }]
        : [{ updatedAt: 'desc' }, { productId: 'asc' }];
}

function buildNestedSortFilter(input: CanonicalProductSearchInput): Record<string, unknown> {
    const filter = buildItemFilters(input);
    return filter.length > 0 ? { bool: { filter } } : { match_all: {} };
}

function buildItemFilters(input: CanonicalProductSearchInput): unknown[] {
    const filter: unknown[] = [];
    if (input.minPrice !== null || input.maxPrice !== null) {
        filter.push({
            range: {
                'items.totalPrice': {
                    ...(input.minPrice === null ? {} : { gte: Number(input.minPrice) }),
                    ...(input.maxPrice === null ? {} : { lte: Number(input.maxPrice) }),
                },
            },
        });
    }
    if (input.sku !== null) filter.push({ term: { 'items.sku': input.sku } });
    for (const { optionCode, valueCode } of input.options) {
        filter.push({ term: { 'items.optionTokens': `${optionCode}:${valueCode}` } });
    }
    return filter;
}

function normalizeQuery(value: string | null | undefined): string | null {
    if (value === null || value === undefined) return null;
    const normalized = value.trim().replace(/\s+/gu, ' ');
    if (normalized === '') return null;
    if ([...normalized].length > 200) invalidInput('query must not exceed 200 characters');
    return normalized;
}

function normalizeKeyword(value: string | null | undefined, pattern: RegExp, field: string): string | null {
    if (value === null || value === undefined) return null;
    const normalized = value.trim();
    if (!pattern.test(normalized)) invalidInput(`${field} has an invalid format`);
    return normalized;
}

function normalizeRequiredCode(value: string, field: string): string {
    const normalized = value.trim();
    if (!OPTION_CODE_PATTERN.test(normalized)) invalidInput(`${field} has an invalid format`);
    return normalized;
}

function normalizePrice(value: string | null | undefined, field: string): string | null {
    if (value === null || value === undefined) return null;
    const normalized = value.trim();
    if (!PRICE_PATTERN.test(normalized)) invalidInput(`${field} must be a non-negative decimal with up to 3 places`);
    const [integer, fraction = ''] = normalized.split('.');
    return `${integer}.${fraction.padEnd(3, '0')}`;
}

function toScaledPrice(value: string): bigint {
    return BigInt(value.replace('.', ''));
}

function signCursor(encodedPayload: string, secret: string): string {
    return createHmac('sha256', secret).update(encodedPayload).digest('base64url');
}

function isSearchCursorPayload(value: unknown): value is SearchCursorPayload {
    if (!value || typeof value !== 'object') return false;
    const candidate = value as Partial<SearchCursorPayload>;
    return (
        candidate.v === CURSOR_VERSION &&
        typeof candidate.p === 'string' &&
        candidate.p.length > 0 &&
        candidate.p.length <= 4_096 &&
        typeof candidate.f === 'string' &&
        candidate.f.length > 0 &&
        candidate.f.length <= 128 &&
        Number.isSafeInteger(candidate.e) &&
        Array.isArray(candidate.s) &&
        candidate.s.length > 0 &&
        candidate.s.length <= 10 &&
        candidate.s.every(
            (entry) =>
                entry === null || typeof entry === 'string' || (typeof entry === 'number' && Number.isFinite(entry))
        )
    );
}

function invalidInput(message: string): never {
    throw new ProductSearchContractError('INVALID_SEARCH_INPUT', message);
}

function invalidCursor(): never {
    throw new ProductSearchContractError('INVALID_SEARCH_CURSOR', 'Search cursor is invalid');
}
