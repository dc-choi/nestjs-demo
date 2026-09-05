import { Injectable, Logger } from '@nestjs/common';

import {
    ProductSearchBackendRequest,
    ProductSearchCursorExpiredError,
    ProductSearchPage,
    ProductSearchPort,
    ProductSearchUnavailableError,
} from '~/api/catalog/search/application/product-search.port';
import { ProductSearchItemDocument } from '~/api/catalog/search/domain/product-search.document';
import {
    CanonicalProductSearchInput,
    ProductSearchSort,
    SearchSortValue,
} from '~/api/catalog/search/domain/product-search.query';
import { getCurrentRequestId } from '~/global/common/context/request-context';
import {
    OpenSearchHttpClient,
    OpenSearchHttpError,
    escapeOpenSearchPathSegment,
} from '~/infra/search/opensearch.client';
import { SearchConfig } from '~/infra/search/search.config';

interface OpenSearchProductHit {
    _source?: {
        productId?: unknown;
        slug?: unknown;
        name?: unknown;
    };
    sort?: unknown[];
    inner_hits?: {
        selected_item?: {
            hits?: {
                hits?: Array<{ _source?: Partial<ProductSearchItemDocument> }>;
            };
        };
    };
}

interface OpenSearchProductSearchResponse {
    pit_id?: string;
    hits?: {
        hits?: OpenSearchProductHit[];
    };
}

interface OpenPointInTimeResponse {
    pit_id?: string;
}

@Injectable()
export class OpenSearchProductSearchAdapter implements ProductSearchPort {
    private readonly logger = new Logger(OpenSearchProductSearchAdapter.name);

    constructor(
        private readonly config: SearchConfig,
        private readonly client: OpenSearchHttpClient
    ) {}

    isAvailable(): boolean {
        return this.config.enabled;
    }

    async search(request: ProductSearchBackendRequest): Promise<ProductSearchPage> {
        if (!this.config.enabled) {
            throw new ProductSearchUnavailableError('SEARCH_DISABLED', 'Product search is disabled');
        }

        const pitId = request.sessionId ?? (await this.openPointInTime());
        try {
            const response = await this.client.request<OpenSearchProductSearchResponse>('POST', '/_search', {
                body: buildOpenSearchProductRequest(request.input, pitId, request.searchAfter ?? undefined),
            });
            const hits = response.hits?.hits;
            if (!Array.isArray(hits)) throw new Error('OpenSearch Search response did not contain hits');
            const hasNextPage = hits.length > request.input.first;
            const pageHits = hits.slice(0, request.input.first);
            const nextSortValues = hasNextPage ? parseSortValues(pageHits.at(-1)?.sort) : null;
            return {
                sessionId: response.pit_id ?? pitId,
                nodes: pageHits.map(toProductSearchNode),
                hasNextPage,
                nextSortValues,
            };
        } catch (error) {
            if (request.sessionId && isExpiredPointInTimeError(error)) throw new ProductSearchCursorExpiredError();
            throw this.unavailable(error);
        }
    }

    async close(sessionId: string): Promise<void> {
        try {
            await this.client.request('DELETE', '/_search/point_in_time', { body: { pit_id: sessionId } });
        } catch (error) {
            this.logger.warn({
                type: 'OPENSEARCH PIT CLOSE FAILURE',
                status: error instanceof OpenSearchHttpError ? error.status : null,
            });
        }
    }

    private async openPointInTime(): Promise<string> {
        try {
            const response = await this.client.request<OpenPointInTimeResponse>(
                'POST',
                `/${escapeOpenSearchPathSegment(this.config.readAlias)}/_search/point_in_time`,
                { query: { keep_alive: '1m' } }
            );
            if (typeof response.pit_id !== 'string' || response.pit_id === '') {
                throw new Error('OpenSearch did not return a point-in-time ID');
            }
            return response.pit_id;
        } catch (error) {
            throw this.unavailable(error);
        }
    }

    private unavailable(error: unknown): ProductSearchUnavailableError {
        this.logger.error({
            type: 'OPENSEARCH REQUEST FAILURE',
            requestId: getCurrentRequestId() ?? 'unknown',
            status: error instanceof OpenSearchHttpError ? error.status : null,
        });
        return new ProductSearchUnavailableError('SEARCH_UNAVAILABLE', 'Product search is temporarily unavailable', {
            cause: error,
        });
    }
}

export function buildOpenSearchProductRequest(
    input: CanonicalProductSearchInput,
    pitId: string,
    searchAfter?: readonly SearchSortValue[]
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
    if (input.categorySlug !== null) rootFilters.unshift({ term: { categoryAncestorSlugs: input.categorySlug } });

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

function toProductSearchNode(hit: OpenSearchProductHit) {
    const source = hit._source;
    const item = hit.inner_hits?.selected_item?.hits?.hits?.[0]?._source;
    if (
        typeof source?.productId !== 'string' ||
        typeof source.slug !== 'string' ||
        typeof source.name !== 'string' ||
        typeof item?.itemId !== 'string' ||
        typeof item.name !== 'string' ||
        (typeof item.totalPrice !== 'number' && typeof item.totalPrice !== 'string')
    ) {
        throw new Error('OpenSearch product hit did not match the search document contract');
    }

    const price = Number(item.totalPrice);
    if (!Number.isFinite(price) || price < 0) throw new Error('OpenSearch product hit contained an invalid price');
    return {
        productId: source.productId,
        slug: source.slug,
        name: source.name,
        itemId: item.itemId,
        itemName: item.name,
        price: { amount: price.toFixed(3), currencyCode: 'KRW' },
        thumbnail: null,
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

function parseSortValues(value: unknown[] | undefined): SearchSortValue[] {
    if (
        !Array.isArray(value) ||
        value.length === 0 ||
        !value.every(
            (entry) =>
                entry === null || typeof entry === 'string' || (typeof entry === 'number' && Number.isFinite(entry))
        )
    ) {
        throw new Error('OpenSearch product hit did not contain usable sort values');
    }
    return value as SearchSortValue[];
}

function isExpiredPointInTimeError(error: unknown): boolean {
    if (!(error instanceof OpenSearchHttpError) || (error.status !== 400 && error.status !== 404)) return false;
    return JSON.stringify(error.responseBody).includes('search_context_missing_exception');
}
