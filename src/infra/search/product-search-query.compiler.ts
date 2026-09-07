import {
    CanonicalProductSearchInput,
    ProductSearchSort,
    SearchSortValue,
} from '~/api/catalog/search/domain/product-search.query';

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
