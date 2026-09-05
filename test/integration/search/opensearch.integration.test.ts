import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ProductSearchService } from '~/api/catalog/search/application/product-search.service';
import { ProductSearchDocument } from '~/api/catalog/search/domain/product-search.document';
import { createCatalogIndexName } from '~/infra/search/catalog-index.definition';
import { CatalogBulkError, CatalogIndexManager } from '~/infra/search/catalog-index.manager';
import { OpenSearchHttpClient } from '~/infra/search/opensearch.client';
import { SearchHealthService } from '~/infra/search/search-health.service';
import { SearchRelevanceEvaluationService } from '~/infra/search/search-relevance-evaluation.service';
import { SearchConfig } from '~/infra/search/search.config';

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
        cursorSecret: 'integration-test-cursor-secret-at-least-32',
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
        await expect(health.verifyNoriAnalyzer()).resolves.not.toHaveLength(0);

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
        await manager.writeExternal(updated);
        await expect(manager.writeExternal(documents[0])).rejects.toBeInstanceOf(CatalogBulkError);
        await expect(manager.getDocument(config.writeAlias, '1')).resolves.toMatchObject({
            version: 2,
            source: { productRevision: 2, name: '무선 기계식 키보드' },
        });
        await manager.repairExternal({ ...updated, name: '복구된 무선 키보드' });
        await expect(manager.getDocument(config.writeAlias, '1')).resolves.toMatchObject({
            version: 2,
            source: { productRevision: 2, name: '복구된 무선 키보드' },
        });
        await manager.refresh(config.writeAlias);

        const missingAlias = `catalog-products-missing-${suffix}`;
        const missingAliasManager = new CatalogIndexManager(client, { ...config, writeAlias: missingAlias });
        await expect(missingAliasManager.writeExternal(documents[0])).rejects.toBeInstanceOf(CatalogBulkError);
        await expect(client.request('GET', `/${missingAlias}`)).rejects.toMatchObject({ status: 404 });

        const search = new ProductSearchService(config, client);
        const input = {
            categorySlug: 'keyboards',
            minPrice: '1000',
            maxPrice: '2000',
            options: [{ optionCode: 'color', valueCode: 'black' }],
            first: 1,
        };
        const firstPage = await search.search(input);
        expect(firstPage).toMatchObject({
            nodes: [{ productId: '1', itemId: '11', price: { amount: '1500.000', currencyCode: 'KRW' } }],
            pageInfo: { hasNextPage: true },
        });
        expect(typeof firstPage.pageInfo.endCursor).toBe('string');
        await expect(search.search({ ...input, after: firstPage.pageInfo.endCursor })).resolves.toMatchObject({
            nodes: [{ productId: '2' }],
            pageInfo: { hasNextPage: false, endCursor: null },
        });

        const relevance = await new SearchRelevanceEvaluationService(client).compare(
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

        await manager.repairDeleteExternal('2', 1);
        await expect(manager.getDocument(config.writeAlias, '2')).resolves.toBeNull();
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
