import { Injectable } from '@nestjs/common';

import { CatalogAnalyzer, catalogIndexDefinition, catalogNoriIndexDefinition } from './catalog-index.definition';
import { OpenSearchHttpClient, OpenSearchHttpError, escapeOpenSearchPathSegment } from './opensearch.client';
import { SearchConfig } from './search.config';

import { createHash } from 'node:crypto';
import { ProductSearchDocument } from '~/api/catalog/search/domain/product-search.document';

interface AliasResponse {
    [index: string]: {
        aliases?: Record<string, { is_write_index?: boolean }>;
    };
}

interface BulkItemResult {
    _id?: string;
    status?: number;
    error?: unknown;
}

interface BulkResponse {
    errors?: boolean;
    items?: Array<Record<string, BulkItemResult>>;
}

interface CountResponse {
    count?: number;
}

interface GetResponse {
    _id?: string;
    _version?: number;
    found?: boolean;
    _source?: ProductSearchDocument;
}

interface MultiGetResponse {
    docs?: GetResponse[];
}

interface SearchResponse {
    pit_id?: string;
    hits?: {
        hits?: Array<{
            _id?: string;
            _version?: number;
            _source?: ProductSearchDocument;
            sort?: unknown[];
        }>;
    };
}

export interface StoredProductSearchDocument {
    id: string;
    version: number;
    source: ProductSearchDocument;
}

export interface CatalogAliasTargets {
    readonly read: readonly string[];
    readonly write: readonly string[];
}

export interface CatalogWriteTarget {
    readonly indexName: string;
    readonly writeAlias: string;
}

export interface CatalogBulkFailure {
    documentId: string;
    status: number;
    error: unknown;
}

export class CatalogBulkError extends Error {
    constructor(readonly failures: CatalogBulkFailure[]) {
        super(`OpenSearch Bulk failed for ${failures.length} catalog document(s)`);
        this.name = CatalogBulkError.name;
    }
}

@Injectable()
export class CatalogIndexManager {
    constructor(
        private readonly client: OpenSearchHttpClient,
        private readonly config: SearchConfig
    ) {}

    async createIndex(indexName: string, analyzer: CatalogAnalyzer = 'standard'): Promise<void> {
        await this.client.request('PUT', `/${escapeOpenSearchPathSegment(indexName)}`, {
            body: {
                ...(analyzer === 'nori' ? catalogNoriIndexDefinition : catalogIndexDefinition),
                aliases: { [projectionWriteAlias(indexName)]: { is_write_index: true } },
            },
        });
    }

    async resolveWriteTarget(): Promise<CatalogWriteTarget> {
        const targets = await this.getAliasTargets(this.config.writeAlias);
        if (targets.length !== 1) throw new Error('Catalog write alias must reference exactly one index');
        const indexName = targets[0];
        const writeAlias = projectionWriteAlias(indexName);
        const pinnedTargets = await this.getAliasTargets(writeAlias);
        if (pinnedTargets.length === 0) {
            // Adopt indexes created before generation-specific aliases were introduced.
            await this.client.request('POST', '/_aliases', {
                body: { actions: [{ add: { index: indexName, alias: writeAlias, is_write_index: true } }] },
            });
        } else if (pinnedTargets.length !== 1 || pinnedTargets[0] !== indexName) {
            throw new Error('Catalog projection alias does not match its physical index');
        }
        return { indexName, writeAlias };
    }

    async deleteIndex(indexName: string): Promise<void> {
        try {
            await this.client.request('DELETE', `/${escapeOpenSearchPathSegment(indexName)}`);
        } catch (error) {
            if (!(error instanceof OpenSearchHttpError) || !error.isNotFound) throw error;
        }
    }

    async bulkIndex(indexName: string, documents: readonly ProductSearchDocument[]): Promise<void> {
        let pending = [...documents];
        for (let attempt = 0; pending.length > 0; attempt += 1) {
            const failures = await this.sendBulkIndex(indexName, pending, false);
            if (failures.length === 0) return;
            const terminal = failures.filter(({ status }) => !isRetryableStatus(status));
            if (terminal.length > 0 || attempt >= 3) throw new CatalogBulkError(failures);

            const retryIds = new Set(failures.map(({ documentId }) => documentId));
            pending = pending.filter(({ productId }) => retryIds.has(productId));
            await delay(100 * 2 ** attempt);
        }
    }

    async writeExternal(document: ProductSearchDocument, target: CatalogWriteTarget): Promise<void> {
        const failures = await this.sendBulkIndex(target.writeAlias, [document], true, 'external');
        if (failures.length > 0) throw new CatalogBulkError(failures);
    }

    async repairExternal(document: ProductSearchDocument, target: CatalogWriteTarget): Promise<void> {
        const failures = await this.sendBulkIndex(target.writeAlias, [document], true, 'external_gte');
        if (failures.length > 0) throw new CatalogBulkError(failures);
    }

    async deleteExternal(productId: string, productRevision: number, target: CatalogWriteTarget): Promise<void> {
        await this.sendBulkDelete(productId, productRevision, 'external', target);
    }

    async repairDeleteExternal(productId: string, productRevision: number, target: CatalogWriteTarget): Promise<void> {
        await this.sendBulkDelete(productId, productRevision, 'external_gte', target);
    }

    private async sendBulkDelete(
        productId: string,
        productRevision: number,
        versionType: 'external' | 'external_gte',
        target: CatalogWriteTarget
    ): Promise<void> {
        const ndjson = serializeNdjson([
            {
                delete: {
                    _index: target.writeAlias,
                    _id: productId,
                    version: productRevision,
                    version_type: versionType,
                },
            },
        ]);
        const response = await this.client.request<BulkResponse>('POST', '/_bulk', {
            query: { require_alias: true },
            ndjson,
        });
        const failures = parseBulkFailures(response, [productId]);
        if (failures.length > 0) throw new CatalogBulkError(failures);
    }

    async refresh(indexName: string): Promise<void> {
        await this.client.request('POST', `/${escapeOpenSearchPathSegment(indexName)}/_refresh`);
    }

    async count(indexName: string): Promise<number> {
        const result = await this.client.request<CountResponse>(
            'GET',
            `/${escapeOpenSearchPathSegment(indexName)}/_count`
        );
        if (!Number.isSafeInteger(result.count) || (result.count ?? -1) < 0) {
            throw new Error('OpenSearch Count response did not contain a valid count');
        }
        return result.count as number;
    }

    async verifyQueryable(indexName: string): Promise<void> {
        await this.client.request('POST', `/${escapeOpenSearchPathSegment(indexName)}/_search`, {
            body: {
                size: 1,
                query: { match_all: {} },
                sort: [{ productId: 'asc' }],
                _source: ['productId', 'productRevision'],
            },
        });
    }

    async getActiveAliasTargets(): Promise<CatalogAliasTargets> {
        const [read, write] = await Promise.all([
            this.getAliasTargets(this.config.readAlias),
            this.getAliasTargets(this.config.writeAlias),
        ]);
        return { read, write };
    }

    async cutOverAliases(indexName: string, expected?: CatalogAliasTargets): Promise<void> {
        const targets = expected ?? (await this.getActiveAliasTargets());
        const actions: unknown[] = [];
        // A delayed rebuild must not replace aliases already moved by its successor.
        for (const index of targets.read) {
            actions.push({ remove: { index, alias: this.config.readAlias, must_exist: true } });
        }
        for (const index of targets.write) {
            actions.push({ remove: { index, alias: this.config.writeAlias, must_exist: true } });
        }
        // On first activation, the single-write-index constraint rejects competing additions atomically.
        actions.push(
            { add: { index: indexName, alias: this.config.readAlias } },
            { add: { index: indexName, alias: this.config.writeAlias, is_write_index: true } }
        );
        await this.client.request('POST', '/_aliases', { body: { actions } });
    }

    async replaceReadAlias(indexName: string, alias: string): Promise<void> {
        const targets = await this.getAliasTargets(alias);
        const actions: unknown[] = targets.map((index) => ({ remove: { index, alias } }));
        actions.push({ add: { index: indexName, alias } });
        await this.client.request('POST', '/_aliases', { body: { actions } });
    }

    async hasAlias(alias: string): Promise<boolean> {
        return (await this.getAliasTargets(alias)).length > 0;
    }

    async getDocument(indexOrAlias: string, productId: string): Promise<StoredProductSearchDocument | null> {
        try {
            const response = await this.client.request<GetResponse>(
                'GET',
                `/${escapeOpenSearchPathSegment(indexOrAlias)}/_doc/${escapeOpenSearchPathSegment(productId)}`
            );
            if (!response.found || !response._source || !Number.isSafeInteger(response._version)) return null;
            return { id: response._id ?? productId, version: response._version as number, source: response._source };
        } catch (error) {
            if (error instanceof OpenSearchHttpError && error.isNotFound) return null;
            throw error;
        }
    }

    async getDocuments(
        indexOrAlias: string,
        productIds: readonly string[]
    ): Promise<Map<string, StoredProductSearchDocument>> {
        if (productIds.length === 0) return new Map();
        const response = await this.client.request<MultiGetResponse>(
            'POST',
            `/${escapeOpenSearchPathSegment(indexOrAlias)}/_mget`,
            { body: { ids: productIds } }
        );
        if (!Array.isArray(response.docs) || response.docs.length !== productIds.length) {
            throw new Error('OpenSearch Multi Get response did not match the request');
        }

        const documents = new Map<string, StoredProductSearchDocument>();
        for (const [index, document] of response.docs.entries()) {
            if (!document.found) continue;
            if (!document._source || !Number.isSafeInteger(document._version)) {
                throw new Error(`OpenSearch document ${productIds[index]} did not match the search document contract`);
            }
            const id = document._id ?? productIds[index];
            documents.set(id, { id, version: document._version as number, source: document._source });
        }
        return documents;
    }

    async *scanDocuments(indexOrAlias: string, batchSize = 100): AsyncGenerator<StoredProductSearchDocument[]> {
        if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500) {
            throw new Error('OpenSearch scan batch size must be between 1 and 500');
        }
        const pit = await this.client.request<{ pit_id?: string }>(
            'POST',
            `/${escapeOpenSearchPathSegment(indexOrAlias)}/_search/point_in_time`,
            { query: { keep_alive: '1m' } }
        );
        if (typeof pit.pit_id !== 'string' || pit.pit_id === '') throw new Error('OpenSearch did not return a PIT ID');

        let pitId = pit.pit_id;
        let searchAfter: unknown[] | undefined;
        try {
            while (true) {
                const response = await this.client.request<SearchResponse>('POST', '/_search', {
                    body: {
                        size: batchSize,
                        pit: { id: pitId, keep_alive: '1m' },
                        query: { match_all: {} },
                        sort: ['_shard_doc'],
                        version: true,
                        ...(searchAfter ? { search_after: searchAfter } : {}),
                    },
                });
                const hits = response.hits?.hits;
                if (!Array.isArray(hits)) throw new Error('OpenSearch scan response did not contain hits');
                pitId = response.pit_id ?? pitId;
                if (hits.length === 0) return;

                const documents = hits.map((hit) => {
                    if (!hit._id || !hit._source || !Number.isSafeInteger(hit._version)) {
                        throw new Error('OpenSearch scan hit did not match the search document contract');
                    }
                    return { id: hit._id, version: hit._version as number, source: hit._source };
                });
                yield documents;
                searchAfter = hits.at(-1)?.sort;
                if (!Array.isArray(searchAfter) || searchAfter.length === 0) {
                    throw new Error('OpenSearch scan hit did not contain sort values');
                }
                if (hits.length < batchSize) return;
            }
        } finally {
            try {
                await this.client.request('DELETE', '/_search/point_in_time', { body: { pit_id: pitId } });
            } catch {
                // PIT expires automatically; reconciliation results are still valid.
            }
        }
    }

    private async sendBulkIndex(
        indexName: string,
        documents: readonly ProductSearchDocument[],
        requireAlias: boolean,
        versionType: 'external' | 'external_gte' = 'external'
    ): Promise<CatalogBulkFailure[]> {
        if (documents.length === 0) return [];
        const lines: unknown[] = [];
        for (const document of documents) {
            lines.push(
                {
                    index: {
                        _index: indexName,
                        _id: document.productId,
                        version: document.productRevision,
                        version_type: versionType,
                    },
                },
                document
            );
        }
        const response = await this.client.request<BulkResponse>('POST', '/_bulk', {
            query: requireAlias ? { require_alias: true } : undefined,
            ndjson: serializeNdjson(lines),
        });
        return parseBulkFailures(
            response,
            documents.map(({ productId }) => productId)
        );
    }

    private async getAliasTargets(alias: string): Promise<string[]> {
        try {
            const response = await this.client.request<AliasResponse>(
                'GET',
                `/_alias/${escapeOpenSearchPathSegment(alias)}`
            );
            return Object.keys(response);
        } catch (error) {
            if (error instanceof OpenSearchHttpError && error.isNotFound) return [];
            throw error;
        }
    }
}

function projectionWriteAlias(indexName: string): string {
    return `catalog-projection-${createHash('sha256').update(indexName).digest('hex')}`;
}

function parseBulkFailures(response: BulkResponse, expectedIds: readonly string[]): CatalogBulkFailure[] {
    if (!Array.isArray(response.items) || response.items.length !== expectedIds.length) {
        throw new Error('OpenSearch Bulk response item count did not match the request');
    }

    const failures: CatalogBulkFailure[] = [];
    for (const [index, item] of response.items.entries()) {
        const result = item.index ?? item.delete;
        const documentId = result?._id ?? expectedIds[index];
        const status = result?.status;
        if (!result || !Number.isInteger(status)) {
            failures.push({ documentId, status: 500, error: 'Malformed Bulk item response' });
            continue;
        }
        if ((status as number) >= 300) failures.push({ documentId, status: status as number, error: result.error });
    }
    if (response.errors === false && failures.length > 0) {
        throw new Error('OpenSearch Bulk response reported errors=false but contained failed items');
    }
    if (response.errors !== false && failures.length === 0) {
        throw new Error('OpenSearch Bulk response did not confirm that every item succeeded');
    }
    return failures;
}

function serializeNdjson(lines: readonly unknown[]): string {
    return `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`;
}

function isRetryableStatus(status: number): boolean {
    return status === 429 || status >= 500;
}

function delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
