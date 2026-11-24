import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CatalogWriteConflictError } from '~/api/search/application/catalog-write-conflict.error.js';
import { ProductSearchService } from '~/api/search/application/product-search.service.js';
import { ProductSearchDocument } from '~/api/search/domain/product-search.document.js';
import { CatalogBulkError } from '~/api/search/infrastructure/catalog-bulk.error.js';
import { createCatalogIndexName } from '~/api/search/infrastructure/catalog-index.definition.js';
import { CatalogIndexManager } from '~/api/search/infrastructure/catalog-index.manager.js';
import { OpenSearchProductSearchAdapter } from '~/api/search/infrastructure/opensearch-product-search.adapter.js';
import { OpenSearchHttpClient } from '~/infra/opensearch/opensearch.client.js';
import { SearchHealthService } from '~/api/search/application/search-health.service.js';
import { SearchRelevanceEvaluationService } from '~/api/search/application/search-relevance-evaluation.service.js';
import { SearchConfig } from '~/infra/opensearch/search.config.js';

const describeOpenSearch = process.env.OPENSEARCH_INTEGRATION === '1' ? describe : describe.skip;

describeOpenSearch('OpenSearch catalog integration', () => {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
    const indexName = createCatalogIndexName(`integration-${suffix}`);
    const noriIndexName = createCatalogIndexName(`integration-nori-${suffix}`, 'nori');
    const noriAlias = `catalog-products-nori-${suffix}`;
    const config = {
        enabled: true,
        nodeUrl: new URL(process.env.OPENSEARCH_NODE_URL ?? 'http://127.0.0.1:9200'),
        readAlias: `catalog-products-read-${suffix}`,
        writeAlias: `catalog-products-write-${suffix}`,
        requestTimeoutMs: 5_000,
    } as SearchConfig;
    const client = new OpenSearchHttpClient(config);
    const manager = new CatalogIndexManager(client, config);

    beforeAll(async () => {
        await Promise.all([manager.createIndex(indexName), manager.createIndex(noriIndexName, 'nori')]);
    });

    afterAll(async () => {
        await Promise.all([manager.deleteIndex(indexName), manager.deleteIndex(noriIndexName)]);
    });

    it('verifies health, Nori, strict mapping, Bulk items, aliases and nested search', async () => {
        const health = new SearchHealthService(config, client);
        await expect(health.check()).resolves.toMatchObject({ enabled: true, reachable: true });
        const plugins = await client.request<Array<{ component?: string }>>('GET', '/_cat/plugins', {
            query: { format: 'json' },
        });
        expect(plugins).toEqual(expect.arrayContaining([expect.objectContaining({ component: 'analysis-nori' })]));
        const analysis = await client.request<{ tokens?: unknown[] }>('POST', '/_analyze', {
            body: { tokenizer: 'nori_tokenizer', text: '무선 기계식 키보드' },
        });
        expect(analysis.tokens).not.toHaveLength(0);

        const documents = [createDocument('1'), createDocument('2')];
        await Promise.all([manager.bulkIndex(indexName, documents), manager.bulkIndex(noriIndexName, documents)]);
        const invalid = { ...createDocument('3'), unexpected: true } as ProductSearchDocument;
        await expect(manager.bulkIndex(indexName, [invalid])).rejects.toBeInstanceOf(CatalogBulkError);

        await Promise.all([manager.refresh(indexName), manager.refresh(noriIndexName)]);
        await expect(manager.hasAlias(config.writeAlias)).resolves.toBe(false);
        await manager.cutOverAliases(indexName);
        await expect(manager.hasAlias(config.writeAlias)).resolves.toBe(true);
        await manager.replaceReadAlias(noriIndexName, noriAlias);

        const updated = { ...documents[0], productRevision: 2, name: '무선 기계식 키보드' };
        const target = await manager.resolveWriteTarget();
        const absentId = `missing-${suffix}`;
        await expect(manager.deleteExternal(absentId, 1, target)).resolves.toBeUndefined();
        await expect(manager.repairDeleteExternal(absentId, 1, target)).resolves.toBeUndefined();
        await manager.writeExternal(updated, target);
        await expect(manager.writeExternal(documents[0], target)).rejects.toBeInstanceOf(CatalogWriteConflictError);
        await expect(manager.getDocument(config.writeAlias, '1')).resolves.toMatchObject({
            version: 2,
            source: { productRevision: 2, name: '무선 기계식 키보드' },
        });
        await manager.repairExternal({ ...updated, name: '복구된 무선 키보드' }, target);
        await expect(manager.getDocument(config.writeAlias, '1')).resolves.toMatchObject({
            version: 2,
            source: { productRevision: 2, name: '복구된 무선 키보드' },
        });
        await manager.refresh(config.writeAlias);

        const missingAlias = `catalog-products-missing-${suffix}`;
        const missingAliasManager = new CatalogIndexManager(client, { ...config, writeAlias: missingAlias });
        await expect(missingAliasManager.resolveWriteTarget()).rejects.toThrow('exactly one index');
        await expect(client.request('GET', `/${missingAlias}`)).rejects.toMatchObject({ status: 404 });

        const adapter = new OpenSearchProductSearchAdapter(config, client);
        const search = new ProductSearchService(adapter, 'integration-test-cursor-secret-at-least-32');
        const input = {
            categorySlug: 'keyboards',
            minPrice: '1000',
            maxPrice: '2000',
            options: [{ optionCode: 'color', valueCode: 'black' }],
            first: 1,
        };
        const firstPage = await search.search(input);
        expect(firstPage).toMatchObject({
            nodes: [{ productId: '1', itemId: '11', price: 1500 }],
            pageInfo: { hasNextPage: true },
        });
        expect(typeof firstPage.pageInfo.endCursor).toBe('string');
        await expect(search.search({ ...input, after: firstPage.pageInfo.endCursor })).resolves.toMatchObject({
            nodes: [{ productId: '2' }],
            pageInfo: { hasNextPage: false, endCursor: null },
        });

        const relevance = await new SearchRelevanceEvaluationService(adapter).compare(
            {
                name: 'standard-vs-nori',
                queries: [{ id: 'wireless', input: { query: '무선 키보드' }, judgments: { '1': 3 } }],
            },
            config.readAlias,
            noriAlias
        );
        expect(relevance.baseline.recallAt10).toBe(1);
        expect(relevance.candidate.recallAt10).toBe(1);
        expect(relevance.regressedQueries).toEqual([]);

        await manager.repairDeleteExternal('2', 1, target);
        await expect(manager.getDocument(config.writeAlias, '2')).resolves.toBeNull();
    });

    it('keeps writes on their admitted generation after cutover and fails closed after its removal', async () => {
        const retiredIndex = createCatalogIndexName(`retired-${suffix}`);
        const activeIndex = createCatalogIndexName(`active-${suffix}`);
        try {
            await manager.createIndex(retiredIndex);
            await manager.createIndex(activeIndex);
            await manager.cutOverAliases(retiredIndex);
            const target = await manager.resolveWriteTarget();
            await manager.cutOverAliases(activeIndex);

            await manager.writeExternal(createDocument('7'), target);
            await expect(manager.getDocument(activeIndex, '7')).resolves.toBeNull();
            await expect(manager.getDocument(retiredIndex, '7')).resolves.not.toBeNull();

            await manager.deleteIndex(retiredIndex);
            await expect(manager.writeExternal(createDocument('8'), target)).rejects.toBeInstanceOf(
                CatalogWriteConflictError
            );
            await expect(client.request('GET', `/${retiredIndex}`)).rejects.toMatchObject({ status: 404 });
            await expect(client.request('GET', `/${target.writeAlias}`)).rejects.toMatchObject({ status: 404 });
        } finally {
            await manager.deleteIndex(retiredIndex);
            await manager.deleteIndex(activeIndex);
        }
    });
});

function createDocument(productId: string): ProductSearchDocument {
    return {
        schemaVersion: 1,
        productId,
        productRevision: 1,
        sellerId: '2',
        slug: `keyboard-${productId}`,
        updatedAt: '2026-08-12T10:00:00.000Z',
        name: '무선 키보드',
        description: '저소음 키보드',
        tags: ['무선'],
        categoryIds: ['3'],
        categorySlugs: ['keyboards'],
        categoryNames: ['키보드'],
        categoryAncestorSlugs: ['electronics', 'keyboards'],
        thumbnail: null,
        minPrice: 1500,
        maxPrice: 1500,
        items: [
            {
                itemId: '11',
                sku: 'sku-black',
                name: '검정',
                sequence: 0,
                totalPrice: 1500,
                isTaxFree: false,
                optionTokens: ['color:black'],
            },
        ],
    };
}
