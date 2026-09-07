import { Injectable, Logger } from '@nestjs/common';

import { buildOpenSearchProductRequest } from './product-search-query.compiler';

import {
    ProductSearchBackendRequest,
    ProductSearchCursorExpiredError,
    ProductSearchPage,
    ProductSearchPort,
    ProductSearchUnavailableError,
} from '~/api/catalog/search/application/product-search.port';
import { ProductSearchItemDocument } from '~/api/catalog/search/domain/product-search.document';
import { SearchSortValue } from '~/api/catalog/search/domain/product-search.query';
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

        const ownsPointInTime = request.sessionId === null;
        let pitId = request.sessionId ?? (await this.openPointInTime());
        try {
            const response = await this.client.request<OpenSearchProductSearchResponse>('POST', '/_search', {
                body: buildOpenSearchProductRequest(request.input, pitId, request.searchAfter ?? undefined),
            });
            pitId = response.pit_id ?? pitId;
            const hits = response.hits?.hits;
            if (!Array.isArray(hits)) throw new Error('OpenSearch Search response did not contain hits');
            const hasNextPage = hits.length > request.input.first;
            const pageHits = hits.slice(0, request.input.first);
            const nodes = pageHits.map(toProductSearchNode);
            if (!hasNextPage) {
                return { sessionId: pitId, nodes, hasNextPage: false, nextSortValues: null };
            }
            return {
                sessionId: pitId,
                nodes,
                hasNextPage: true,
                nextSortValues: parseSortValues(pageHits.at(-1)?.sort),
            };
        } catch (error) {
            if (ownsPointInTime || pitId !== request.sessionId) await this.close(pitId);
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
