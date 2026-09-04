import { CATALOG_SEARCH_SCHEMA_VERSION } from '~/api/catalog/search/domain/product-search.document';

export const CATALOG_INDEX_FAMILY = `catalog-products-v${String(CATALOG_SEARCH_SCHEMA_VERSION).padStart(3, '0')}`;
export const CATALOG_NORI_INDEX_FAMILY = 'catalog-products-v002';

export type CatalogAnalyzer = 'standard' | 'nori';

const textField = {
    type: 'text',
    analyzer: 'catalog_text_index',
    search_analyzer: 'catalog_text_search',
} as const;

const textWithKeywordField = {
    ...textField,
    fields: {
        keyword: { type: 'keyword', ignore_above: 256 },
    },
} as const;

export const catalogIndexDefinition = {
    settings: {
        'number_of_shards': 1,
        'number_of_replicas': 0,
        'index.mapping.nested_objects.limit': 10_000,
        'analysis': {
            analyzer: {
                catalog_text_index: {
                    type: 'custom',
                    tokenizer: 'standard',
                    filter: ['lowercase'],
                },
                catalog_text_search: {
                    type: 'custom',
                    tokenizer: 'standard',
                    filter: ['lowercase'],
                },
            },
        },
    },
    mappings: {
        dynamic: 'strict',
        properties: {
            schemaVersion: { type: 'integer' },
            productId: { type: 'keyword' },
            productRevision: { type: 'long' },
            sellerId: { type: 'keyword' },
            slug: { type: 'keyword' },
            updatedAt: { type: 'date' },
            name: textWithKeywordField,
            description: textField,
            tags: textWithKeywordField,
            categoryIds: { type: 'keyword' },
            categorySlugs: { type: 'keyword' },
            categoryNames: { type: 'keyword' },
            categoryAncestorSlugs: { type: 'keyword' },
            thumbnail: {
                type: 'object',
                dynamic: 'strict',
                properties: {
                    storageKey: { type: 'keyword', index: false, doc_values: false },
                    altText: { type: 'keyword', index: false, doc_values: false },
                },
            },
            minPrice: { type: 'scaled_float', scaling_factor: 1000 },
            maxPrice: { type: 'scaled_float', scaling_factor: 1000 },
            items: {
                type: 'nested',
                dynamic: 'strict',
                properties: {
                    itemId: { type: 'keyword' },
                    sku: { type: 'keyword' },
                    name: textWithKeywordField,
                    sequence: { type: 'integer' },
                    totalPrice: { type: 'scaled_float', scaling_factor: 1000 },
                    isTaxFree: { type: 'boolean' },
                    optionTokens: { type: 'keyword' },
                },
            },
        },
    },
} as const;

export const catalogNoriIndexDefinition = {
    ...catalogIndexDefinition,
    settings: {
        ...catalogIndexDefinition.settings,
        analysis: {
            tokenizer: {
                catalog_nori_tokenizer: { type: 'nori_tokenizer', decompound_mode: 'mixed' },
            },
            analyzer: {
                catalog_text_index: {
                    ...catalogIndexDefinition.settings.analysis.analyzer.catalog_text_index,
                    tokenizer: 'catalog_nori_tokenizer',
                },
                catalog_text_search: {
                    ...catalogIndexDefinition.settings.analysis.analyzer.catalog_text_search,
                    tokenizer: 'catalog_nori_tokenizer',
                },
            },
        },
    },
} as const;

export function createCatalogIndexName(buildId: string, analyzer: CatalogAnalyzer = 'standard'): string {
    const normalizedBuildId = buildId.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(normalizedBuildId)) {
        throw new Error('OpenSearch build ID must contain only lowercase letters, numbers, underscores, or hyphens');
    }
    const family = analyzer === 'nori' ? CATALOG_NORI_INDEX_FAMILY : CATALOG_INDEX_FAMILY;
    return `${family}-${normalizedBuildId}`;
}
