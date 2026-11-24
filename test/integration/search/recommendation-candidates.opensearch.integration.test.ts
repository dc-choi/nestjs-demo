import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ProductSearchDocument } from '~/api/catalog/search/domain/product-search.document.js';
import { RecommendationCandidateService } from '~/api/recommendation/application/recommendation-candidate.service.js';
import { RecommendationProfileReader } from '~/api/recommendation/infrastructure/recommendation-profile.reader.js';
import { createCatalogIndexName } from '~/infra/search/catalog-index.definition.js';
import { CatalogIndexManager } from '~/infra/search/catalog-index.manager.js';
import { OpenSearchHttpClient } from '~/infra/search/opensearch.client.js';
import { SearchConfig } from '~/infra/search/search.config.js';

const describeOpenSearch = process.env.OPENSEARCH_INTEGRATION === '1' ? describe : describe.skip;

describeOpenSearch('OpenSearch recommendation candidates', () => {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
    const indexName = createCatalogIndexName(`recommend-${suffix}`);
    const config = {
        enabled: true,
        nodeUrl: new URL(process.env.OPENSEARCH_NODE_URL ?? 'http://127.0.0.1:9200'),
        readAlias: indexName,
        writeAlias: `catalog-products-write-${suffix}`,
        requestTimeoutMs: 5_000,
    } as SearchConfig;
    const client = new OpenSearchHttpClient(config);
    const manager = new CatalogIndexManager(client, config);

    beforeAll(async () => {
        await manager.createIndex(indexName);
        await manager.bulkIndex(indexName, [
            createDocument('1', 'b-1', '5', ['premium', 'brand-01']),
            createDocument('2', 'a-2', '5', ['budget', 'brand-01']),
            createDocument('3', 'a-3', '6', ['premium', 'brand-02']),
            createDocument('4', 'a-4', '5', ['premium', 'brand-01']),
            createDocument('5', 'a-5', '6', ['budget', 'brand-02']),
            createDocument('6', 'a-1', '5', ['standard', 'brand-01']),
        ]);
        await manager.refresh(indexName);
    });

    afterAll(async () => {
        await manager.deleteIndex(indexName);
    });

    it('scores interest by normalized affinity, excludes purchases and checks popular products exist', async () => {
        const popularity = ['4', '5', '404', '1'].map((productId, index) => ({
            productId,
            popularityRank: index + 1,
            buyerCount: 10 - index,
        }));
        const reader = {
            load: async () => ({
                version: 'v1',
                cutoff: '2026-04-01T00:00:00Z',
                popularityCutoff: '2026-04-01T00:00:00Z',
                categories: [{ categoryId: '5', score: 10 }],
                tags: [
                    { tag: 'premium', score: 4 },
                    { tag: 'brand-01', score: 2 },
                ],
                purchasedProductIds: ['4'],
            }),
            readPopularPage: async (_version: string, afterRank: number, limit: number) =>
                popularity.filter(({ popularityRank }) => popularityRank > afterRank).slice(0, limit),
            readPopularity: async (_version: string, productIds: readonly string[]) =>
                popularity.filter(({ productId }) => productIds.includes(productId)),
        } as unknown as RecommendationProfileReader;

        const result = await new RecommendationCandidateService(reader, config, client).findCandidates('7');

        // 1: category + premium + brand-01. 6 and 2 tie at 1.5 and follow the slug. 5 matches nothing.
        // Popular: 4 is purchased, 1 is already an interest candidate and 404 is not in the index.
        expect(
            result.candidates.map(({ productId, source, searchScore, popularityRank }) => [
                productId,
                source,
                searchScore,
                popularityRank,
            ])
        ).toEqual([
            ['1', 'INTEREST', 2.5, 4],
            ['6', 'INTEREST', 1.5, null],
            ['2', 'INTEREST', 1.5, null],
            ['3', 'INTEREST', 1, null],
            ['5', 'POPULAR', null, 2],
        ]);
        expect(result.diagnostics).toMatchObject({
            purchasedExcluded: 1,
            popularPurchasedSkipped: 1,
            popularDuplicatesSkipped: 1,
            popularNotSearchable: 1,
            popularityReads: 1,
            shortage: true,
            openSearchRequests: 2,
        });
    });
});

function createDocument(productId: string, slug: string, categoryId: string, tags: string[]): ProductSearchDocument {
    return {
        schemaVersion: 1,
        productId,
        productRevision: 1,
        sellerId: '2',
        slug,
        updatedAt: '2026-08-12T10:00:00.000Z',
        name: `상품 ${productId}`,
        description: '',
        tags,
        categoryIds: [categoryId],
        categorySlugs: [`category-${categoryId}`],
        categoryNames: [`분류 ${categoryId}`],
        categoryAncestorSlugs: [`category-${categoryId}`],
        thumbnail: null,
        minPrice: 1000,
        maxPrice: 1000,
        items: [
            {
                itemId: productId,
                sku: `sku-${productId}`,
                name: '기본',
                sequence: 0,
                totalPrice: 1000,
                isTaxFree: false,
                optionTokens: [],
            },
        ],
    };
}
