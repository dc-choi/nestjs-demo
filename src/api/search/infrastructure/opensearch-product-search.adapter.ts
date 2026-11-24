import { Injectable, Logger } from '@nestjs/common';

import { buildOpenSearchProductRequest } from './product-search-query.compiler.js';

import { ProductSearchSessionExpiredError } from '~/api/search/application/product-search-session-expired.error.js';
import { ProductSearchUnavailableError } from '~/api/search/application/product-search-unavailable.error.js';
import {
    ProductSearchBackendRequest,
    ProductSearchNode,
    ProductSearchPage,
    ProductSearchPort,
} from '~/api/search/application/product-search.port.js';
import { ProductSearchItemDocument } from '~/api/search/domain/product-search.document.js';
import { CanonicalProductSearchInput, SearchSortValue } from '~/api/search/domain/product-search.query.js';
import { getCurrentRequestId } from '~/global/common/context/request-context.middleware.js';
import { OpenSearchHttpError } from '~/infra/opensearch/opensearch-http.error.js';
import { OpenSearchHttpClient, escapeOpenSearchPathSegment } from '~/infra/opensearch/opensearch.client.js';
import { OpenSearchConfig } from '~/infra/opensearch/opensearch.config.js';

interface OpenSearchProductHit {
    _id?: unknown;
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
    timed_out?: boolean;
    _shards?: { failed?: number };
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
        private readonly config: OpenSearchConfig,
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
        let pitId = request.sessionId ?? (await this.openReadPointInTime());
        try {
            const response = await this.searchPointInTime(
                buildOpenSearchProductRequest(request.input, pitId, request.searchAfter ?? undefined)
            );
            pitId = response.pit_id ?? pitId;
            const hits = completeHits(response);
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
            if (request.sessionId && isExpiredPointInTimeError(error)) throw new ProductSearchSessionExpiredError();
            throw this.unavailable(error);
        }
    }

    /**
     * Returns the top `input.first` product IDs from an explicit index or alias with the same query and
     * completeness checks as search(). Relevance evaluation uses it; errors are not converted to port errors.
     */
    async searchProductIds(indexOrAlias: string, input: CanonicalProductSearchInput): Promise<string[]> {
        let pitId = await this.openPointInTime(indexOrAlias);
        try {
            const response = await this.searchPointInTime({
                ...buildOpenSearchProductRequest(input, pitId),
                size: input.first,
                _source: false,
            });
            pitId = response.pit_id ?? pitId;
            return completeHits(response).map(({ _id }) => {
                if (typeof _id !== 'string') throw new Error('OpenSearch product hit did not contain an ID');
                return _id;
            });
        } finally {
            await this.close(pitId);
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

    private async openReadPointInTime(): Promise<string> {
        try {
            return await this.openPointInTime(this.config.readAlias);
        } catch (error) {
            throw this.unavailable(error);
        }
    }

    private async openPointInTime(indexOrAlias: string): Promise<string> {
        const response = await this.client.request<OpenPointInTimeResponse>(
            'POST',
            `/${escapeOpenSearchPathSegment(indexOrAlias)}/_search/point_in_time`,
            { query: { keep_alive: '1m' } }
        );
        if (typeof response.pit_id !== 'string' || response.pit_id === '') {
            throw new Error('OpenSearch did not return a point-in-time ID');
        }
        return response.pit_id;
    }

    private searchPointInTime(body: Record<string, unknown>): Promise<OpenSearchProductSearchResponse> {
        return this.client.request<OpenSearchProductSearchResponse>('POST', '/_search', {
            query: { allow_partial_search_results: false },
            body,
        });
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

/** Call after taking the response PIT ID so that a rejected page still closes its rotated PIT. */
function completeHits(response: OpenSearchProductSearchResponse): OpenSearchProductHit[] {
    if (response.timed_out === true || (response._shards?.failed ?? 0) > 0) {
        throw new Error('OpenSearch Search response was incomplete');
    }
    const hits = response.hits?.hits;
    if (!Array.isArray(hits)) throw new Error('OpenSearch Search response did not contain hits');
    return hits;
}

function toProductSearchNode(hit: OpenSearchProductHit): ProductSearchNode {
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
        price,
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
