import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

import { ProductSearchItemDocument } from '~/api/catalog/search/domain/product-search.document';
import {
    ProductSearchContractError,
    ProductSearchInput,
    SearchSortValue,
    assertSearchCursorFingerprint,
    buildProductSearchRequest,
    canonicalizeProductSearchInput,
    decodeSearchCursor,
    encodeSearchCursor,
    fingerprintProductSearchInput,
} from '~/api/catalog/search/domain/product-search.query';
import {
    ProductSearchConnectionType,
    ProductSearchNodeType,
} from '~/api/catalog/search/presentation/product-search.type';
import { getCurrentRequestId } from '~/global/common/context/request-context';
import {
    OpenSearchHttpClient,
    OpenSearchHttpError,
    escapeOpenSearchPathSegment,
} from '~/infra/search/opensearch.client';
import { SearchConfig } from '~/infra/search/search.config';

interface ProductSearchHit {
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

interface ProductSearchResponse {
    pit_id?: string;
    hits?: {
        hits?: ProductSearchHit[];
    };
}

interface OpenPointInTimeResponse {
    pit_id?: string;
}

@Injectable()
export class ProductSearchService {
    private readonly logger = new Logger(ProductSearchService.name);

    constructor(
        private readonly config: SearchConfig,
        private readonly client: OpenSearchHttpClient
    ) {}

    async search(input: ProductSearchInput): Promise<ProductSearchConnectionType> {
        if (!this.config.enabled) throw searchUnavailable('SEARCH_DISABLED', 'Product search is disabled');

        try {
            return await this.executeSearch(input);
        } catch (error) {
            if (error instanceof ProductSearchContractError) {
                throw new BadRequestException({ type: error.code, message: error.message });
            }
            if (error instanceof BadRequestException || error instanceof ServiceUnavailableException) throw error;

            this.logger.error({
                type: 'OPENSEARCH REQUEST FAILURE',
                requestId: getCurrentRequestId() ?? 'unknown',
                status: error instanceof OpenSearchHttpError ? error.status : null,
            });
            throw searchUnavailable('SEARCH_UNAVAILABLE', 'Product search is temporarily unavailable');
        }
    }

    private async executeSearch(input: ProductSearchInput): Promise<ProductSearchConnectionType> {
        const canonical = canonicalizeProductSearchInput(input);
        const fingerprint = fingerprintProductSearchInput(canonical);
        const cursor = input.after ? decodeSearchCursor(input.after, this.config.cursorSecret) : null;
        if (cursor) assertSearchCursorFingerprint(cursor, fingerprint);

        const pitId = cursor?.pitId ?? (await this.openPointInTime());
        let response: ProductSearchResponse;
        try {
            response = await this.client.request<ProductSearchResponse>('POST', '/_search', {
                body: buildProductSearchRequest(canonical, pitId, cursor?.sortValues),
            });
        } catch (error) {
            if (cursor && isExpiredPointInTimeError(error)) {
                throw new ProductSearchContractError('SEARCH_CURSOR_EXPIRED', 'Search cursor has expired');
            }
            throw error;
        }

        const hits = response.hits?.hits;
        if (!Array.isArray(hits)) throw new Error('OpenSearch Search response did not contain hits');
        const hasNextPage = hits.length > canonical.first;
        const pageHits = hits.slice(0, canonical.first);
        const nodes = pageHits.map(toSearchNode);
        const currentPitId = response.pit_id ?? pitId;

        if (!hasNextPage) {
            await this.closePointInTime(currentPitId);
            return { nodes, pageInfo: { hasNextPage: false, endCursor: null } };
        }

        const sortValues = parseSortValues(pageHits.at(-1)?.sort);
        return {
            nodes,
            pageInfo: {
                hasNextPage: true,
                endCursor: encodeSearchCursor(currentPitId, sortValues, fingerprint, this.config.cursorSecret),
            },
        };
    }

    private async openPointInTime(): Promise<string> {
        const response = await this.client.request<OpenPointInTimeResponse>(
            'POST',
            `/${escapeOpenSearchPathSegment(this.config.readAlias)}/_search/point_in_time`,
            { query: { keep_alive: '1m' } }
        );
        if (typeof response.pit_id !== 'string' || response.pit_id === '') {
            throw new Error('OpenSearch did not return a point-in-time ID');
        }
        return response.pit_id;
    }

    private async closePointInTime(pitId: string): Promise<void> {
        try {
            await this.client.request('DELETE', '/_search/point_in_time', { body: { pit_id: pitId } });
        } catch (error) {
            this.logger.warn({
                type: 'OPENSEARCH PIT CLOSE FAILURE',
                requestId: getCurrentRequestId() ?? 'unknown',
                status: error instanceof OpenSearchHttpError ? error.status : null,
            });
        }
    }
}

function toSearchNode(hit: ProductSearchHit): ProductSearchNodeType {
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

function searchUnavailable(
    type: 'SEARCH_DISABLED' | 'SEARCH_UNAVAILABLE',
    message: string
): ServiceUnavailableException {
    return new ServiceUnavailableException({ type, message });
}
