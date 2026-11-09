import { MikroORM } from '@mikro-orm/mysql';

import { describe, expect, it, vi } from 'vitest';
import {
    CandidateDocument,
    RecommendationCandidate,
    RecommendationCandidateService,
    buildInterestQuery,
    buildPopularQuery,
} from '~/api/recommendation/application/recommendation-candidate.service';
import { RecommendationUnavailableError } from '~/api/recommendation/application/recommendation-unavailable.error';
import {
    PopularityRow,
    RecommendationProfile,
    RecommendationProfileReader,
} from '~/api/recommendation/infrastructure/recommendation-profile.reader';
import { OpenSearchHttpError } from '~/infra/search/opensearch-http.error';
import { OpenSearchHttpClient } from '~/infra/search/opensearch.client';
import { SearchConfig } from '~/infra/search/search.config';

const ids = (from: number, count: number) => Array.from({ length: count }, (_, index) => String(from + index));
const doc = (productId: string): CandidateDocument => ({
    productId,
    slug: `p-${productId}`,
    categoryIds: ['5'],
    tags: ['budget'],
    minPrice: 1000,
});
const hits = (productIds: readonly string[]) => ({
    timed_out: false,
    _shards: { failed: 0 },
    hits: { hits: productIds.map((id) => ({ _id: id, _score: 1.5, _source: doc(id) })) },
});
const profile = (overrides: Partial<RecommendationProfile> = {}): RecommendationProfile => ({
    version: 'v1',
    cutoff: '2026-04-01T00:00:00Z',
    popularityCutoff: '2026-04-01T00:00:00Z',
    categories: [],
    tags: [],
    purchasedProductIds: [],
    ...overrides,
});
const pick = ({ productId, source, sourceRank, searchScore, popularityRank, buyerCount }: RecommendationCandidate) => ({
    productId,
    source,
    sourceRank,
    searchScore,
    popularityRank,
    buyerCount,
});

describe('recommendation candidate queries', () => {
    it('boosts top categories and exact tags by normalized affinity and excludes purchases', () => {
        const body = buildInterestQuery({
            categories: [
                { categoryId: '7', score: 10 },
                { categoryId: '5', score: 5 },
            ],
            tags: [
                { tag: 'premium', score: 4 },
                { tag: 'brand-01', score: 1 },
            ],
            purchasedProductIds: ['3', '9'],
        });

        expect(body).toEqual({
            size: 150,
            track_total_hits: false,
            _source: ['productId', 'slug', 'categoryIds', 'tags', 'minPrice'],
            query: {
                bool: {
                    should: [
                        { constant_score: { filter: { term: { categoryIds: '7' } }, boost: 1 } },
                        { constant_score: { filter: { term: { categoryIds: '5' } }, boost: 0.5 } },
                        { constant_score: { filter: { term: { 'tags.keyword': 'premium' } }, boost: 1 } },
                        { constant_score: { filter: { term: { 'tags.keyword': 'brand-01' } }, boost: 0.25 } },
                    ],
                    minimum_should_match: 1,
                    must_not: [{ ids: { values: ['3', '9'] } }],
                },
            },
            sort: [{ _score: 'desc' }, { slug: 'asc' }],
        });
        expect(buildInterestQuery(profile()).query).not.toHaveProperty('bool.must_not');
        expect(buildPopularQuery(['2', '1'])).toMatchObject({ size: 2, query: { ids: { values: ['2', '1'] } } });
    });
});

describe('recommendation candidate service', () => {
    const config = { enabled: true, readAlias: 'rec-read' } as SearchConfig;

    /** `popularity` lists product IDs in rank order; `missing` IDs are absent from the read alias. */
    function setup(
        options: {
            profile?: Partial<RecommendationProfile>;
            popularity?: string[];
            interest?: string[];
            missing?: string[];
            respond?: (body: any) => unknown;
        } = {}
    ) {
        const popularity: PopularityRow[] = (options.popularity ?? []).map((productId, index) => ({
            productId,
            popularityRank: index + 1,
            buyerCount: 1000 - index,
        }));
        const missing = new Set(options.missing ?? []);
        const reader = {
            load: vi.fn().mockResolvedValue(profile(options.profile)),
            readPopularPage: vi.fn(async (_version: string, afterRank: number, limit: number) =>
                popularity.filter(({ popularityRank }) => popularityRank > afterRank).slice(0, limit)
            ),
            readPopularity: vi.fn(async (_version: string, productIds: readonly string[]) =>
                popularity.filter(({ productId }) => productIds.includes(productId))
            ),
        };
        const request = vi.fn(async (_method: string, _path: string, { body }: { body: any }) => {
            if (options.respond) return options.respond(body);
            if (body.query.ids) return hits(body.query.ids.values.filter((id: string) => !missing.has(id)));
            return hits(options.interest ?? []);
        });
        const service = new RecommendationCandidateService(reader as unknown as RecommendationProfileReader, config, {
            request,
        } as unknown as OpenSearchHttpClient);
        return { service, reader, request };
    }

    it('merges interest and searchable popular products and reports what was applied', async () => {
        const { service, reader, request } = setup({
            profile: { categories: [{ categoryId: '5', score: 10 }], purchasedProductIds: ['9', '8'] },
            interest: ['1', '7'],
            popularity: ['9', '1', '2', '404', '3', ...ids(1000, 245)],
            missing: ['404'],
        });

        const result = await service.findCandidates('42', 'v1');

        expect(reader.load).toHaveBeenCalledWith('42', 'v1');
        // 198 popular slots plus room for 2 purchased and 2 interest products in the same page.
        expect(reader.readPopularPage.mock.calls).toEqual([['v1', 0, 202]]);
        expect(reader.readPopularity).toHaveBeenCalledWith('v1', ['1', '7']);
        expect(request.mock.calls[0][2].body.query.bool.must_not).toEqual([{ ids: { values: ['9', '8'] } }]);
        expect(request.mock.calls[1][2].body.query.ids.values.slice(0, 3)).toEqual(['2', '404', '3']);
        expect(result.candidates).toHaveLength(200);
        expect(result.candidates.slice(0, 4).map(pick)).toEqual([
            { productId: '1', source: 'INTEREST', sourceRank: 1, searchScore: 1.5, popularityRank: 2, buyerCount: 999 },
            {
                productId: '7',
                source: 'INTEREST',
                sourceRank: 2,
                searchScore: 1.5,
                popularityRank: null,
                buyerCount: 0,
            },
            { productId: '2', source: 'POPULAR', sourceRank: 1, searchScore: null, popularityRank: 3, buyerCount: 998 },
            { productId: '3', source: 'POPULAR', sourceRank: 2, searchScore: null, popularityRank: 5, buyerCount: 996 },
        ]);
        expect(result.candidates[2]).toMatchObject({
            slug: 'p-2',
            categoryIds: ['5'],
            tags: ['budget'],
            minPrice: 1000,
        });
        expect(result.diagnostics).toEqual({
            readAlias: 'rec-read',
            interestCount: 2,
            popularCount: 198,
            purchasedExcluded: 2,
            popularPurchasedSkipped: 1,
            popularDuplicatesSkipped: 1,
            popularNotSearchable: 1,
            popularityReads: 1,
            popularityRowsRead: 202,
            shortage: false,
            openSearchRequests: 2,
        });
    });

    it('reads popularity of the resolved active version in one request without history', async () => {
        const { service, reader, request } = setup({ profile: { version: 'active-v' }, popularity: ids(1, 220) });

        const result = await service.findCandidates('7');

        expect(reader.load).toHaveBeenCalledWith('7', undefined);
        expect(reader.readPopularPage).toHaveBeenCalledWith('active-v', 0, 200);
        expect(request).toHaveBeenCalledTimes(1);
        expect(result.profile.hasHistory).toBe(false);
        expect(result.candidates.map(({ productId }) => productId)).toEqual(ids(1, 200));
        expect(result.candidates.every(({ source }) => source === 'POPULAR')).toBe(true);
        expect(result.diagnostics).toMatchObject({ interestCount: 0, popularCount: 200, shortage: false });
    });

    it('issues the interest query for a tags-only profile', async () => {
        const { service, request } = setup({
            profile: { tags: [{ tag: 'budget', score: 2 }] },
            interest: ['5'],
            popularity: ids(1, 300),
        });

        const result = await service.findCandidates('7');

        expect(request.mock.calls[0][2].body.query.bool.should).toEqual([
            { constant_score: { filter: { term: { 'tags.keyword': 'budget' } }, boost: 1 } },
        ]);
        expect(result.profile.hasHistory).toBe(true);
        expect(result.diagnostics).toMatchObject({
            interestCount: 1,
            popularCount: 199,
            popularDuplicatesSkipped: 1,
            openSearchRequests: 2,
        });
    });

    it('reads the next popularity page when popular products are missing', async () => {
        const { service, reader } = setup({ popularity: ids(1, 400), missing: ids(1, 10) });

        const result = await service.findCandidates('7');

        expect(reader.readPopularPage.mock.calls).toEqual([
            ['v1', 0, 200],
            ['v1', 200, 10],
        ]);
        expect(result.candidates).toHaveLength(200);
        expect(result.candidates[0]).toMatchObject({ productId: '11', popularityRank: 11 });
        expect(result.candidates.at(-1)).toMatchObject({ productId: '210', sourceRank: 200 });
        expect(result.diagnostics).toMatchObject({
            popularNotSearchable: 10,
            popularityReads: 2,
            popularityRowsRead: 210,
            shortage: false,
            openSearchRequests: 2,
        });
    });

    it('stops at the popularity read limit and reports the shortage', async () => {
        const { service } = setup({
            popularity: ids(1, 400),
            missing: [...ids(1, 10), ...ids(201, 5), ...ids(211, 3)],
        });

        const result = await service.findCandidates('7');

        expect(result.candidates).toHaveLength(197);
        expect(result.diagnostics).toMatchObject({
            popularNotSearchable: 18,
            popularityReads: 3,
            popularityRowsRead: 215,
            shortage: true,
            openSearchRequests: 3,
        });
    });

    it('stops at the popularity row limit', async () => {
        const { service, reader } = setup({
            profile: { purchasedProductIds: ids(1, 900) },
            popularity: ids(1, 2_000),
        });

        const result = await service.findCandidates('7');

        expect(reader.readPopularPage.mock.calls).toEqual([['v1', 0, 1_000]]);
        expect(result.diagnostics).toMatchObject({
            popularCount: 100,
            purchasedExcluded: 900,
            popularPurchasedSkipped: 900,
            popularityReads: 1,
            popularityRowsRead: 1_000,
            shortage: true,
        });
    });

    it('reports exhausted or empty popularity as a shortage', async () => {
        const short = setup({ popularity: ids(1, 30) });
        await expect(short.service.findCandidates('7')).resolves.toMatchObject({
            diagnostics: { popularCount: 30, popularityReads: 1, shortage: true },
        });

        const empty = setup();
        const result = await empty.service.findCandidates('7');
        expect(empty.request).not.toHaveBeenCalled();
        expect(result.candidates).toEqual([]);
        expect(result.diagnostics).toMatchObject({ popularityReads: 1, shortage: true, openSearchRequests: 0 });
    });

    it('counts skips only until the selection is full', async () => {
        // 199 slots; the page also holds rank 200 and the missing rank 201 for the 2 skips still possible.
        const { service } = setup({
            profile: { categories: [{ categoryId: '5', score: 1 }], purchasedProductIds: ['600'] },
            interest: ['500'],
            popularity: ids(1, 300),
            missing: ['201'],
        });

        const result = await service.findCandidates('7');

        expect(result.diagnostics).toMatchObject({
            popularCount: 199,
            purchasedExcluded: 1,
            popularPurchasedSkipped: 0,
            popularDuplicatesSkipped: 0,
            popularNotSearchable: 0,
            popularityRowsRead: 201,
            shortage: false,
        });
    });

    it('fills 200 popular products when a user with history gets no interest hits', async () => {
        const { service } = setup({
            profile: { categories: [{ categoryId: '5', score: 1 }] },
            interest: [],
            popularity: ids(1, 250),
        });

        const result = await service.findCandidates('7');

        expect(result.profile.hasHistory).toBe(true);
        expect(result.diagnostics).toMatchObject({
            interestCount: 0,
            popularCount: 200,
            shortage: false,
            openSearchRequests: 2,
        });
    });

    it('accepts exactly half of the popular products and a low second page above half overall', async () => {
        const half = setup({ popularity: ids(1, 200), missing: ids(1, 100) });
        await expect(half.service.findCandidates('7')).resolves.toMatchObject({
            diagnostics: { popularCount: 100, popularNotSearchable: 100, popularityReads: 2, shortage: true },
        });

        // Page 1 finds 180 of 200; page 2 (the last 15 rows) finds 5 of 15, which is 185 of 215 overall.
        const twoPages = setup({ popularity: ids(1, 215), missing: [...ids(1, 20), ...ids(201, 10)] });
        await expect(twoPages.service.findCandidates('7')).resolves.toMatchObject({
            diagnostics: { popularCount: 185, popularityReads: 2, shortage: true },
        });
    });

    it.each([
        ['none', ids(1, 200), ids(1, 200)],
        ['fewer than half', ids(1, 200), ids(1, 101)],
        // Page 1 finds exactly 100 of 200; page 2 finds 40 of 100, which is 140 of 300 overall.
        ['fewer than half overall after a second page', ids(1, 300), [...ids(1, 100), ...ids(201, 60)]],
    ])('fails when the read alias returns %s of the popular products', async (_name, popularity, missing) => {
        const { service } = setup({ popularity, missing });

        await expect(service.findCandidates('7')).rejects.toMatchObject({
            code: 'SEARCH_UNAVAILABLE',
            message: expect.stringContaining('Read alias rec-read returned'),
        });
    });

    it.each([
        ['an HTTP failure', () => Promise.reject(new OpenSearchHttpError(503, null, 'unavailable'))],
        ['a timed out response', () => ({ ...hits(['1']), timed_out: true })],
        ['failed shards', () => ({ ...hits(['1']), _shards: { failed: 1 } })],
        ['a missing hits array', () => ({ timed_out: false })],
        [
            'a hit outside the document contract',
            () => ({ hits: { hits: [{ _id: '1', _source: { productId: '2' } }] } }),
        ],
    ])('reports search unavailable instead of empty candidates on %s', async (_name, respond) => {
        const { service } = setup({ profile: { tags: [{ tag: 'budget', score: 1 }] }, popularity: ['1'], respond });

        await expect(service.findCandidates('7')).rejects.toMatchObject({
            name: RecommendationUnavailableError.name,
            code: 'SEARCH_UNAVAILABLE',
        });
    });

    it.each([
        ['a purchased product', ['9'], ['9']],
        ['a duplicate product', [], ['1', '1']],
    ])('rejects an interest response containing %s', async (_name, purchasedProductIds, interest) => {
        const { service } = setup({
            profile: { tags: [{ tag: 'budget', score: 1 }], purchasedProductIds },
            interest,
            popularity: ['1'],
        });

        await expect(service.findCandidates('7')).rejects.toMatchObject({ code: 'SEARCH_UNAVAILABLE' });
    });

    it('rejects a popular response that repeats a product', async () => {
        const { service } = setup({
            popularity: ['1', '2'],
            respond: (body) => (body.query.ids ? hits(['1', '2', '1']) : hits([])),
        });

        await expect(service.findCandidates('7')).rejects.toMatchObject({ code: 'SEARCH_UNAVAILABLE' });
    });

    it('rejects disabled search and invalid user IDs before reading the profile', async () => {
        const { service, reader } = setup();
        const disabled = new RecommendationCandidateService(
            reader as unknown as RecommendationProfileReader,
            { enabled: false } as SearchConfig,
            { request: vi.fn() } as unknown as OpenSearchHttpClient
        );

        await expect(disabled.findCandidates('7')).rejects.toMatchObject({ code: 'SEARCH_DISABLED' });
        for (const userId of ['0', '-1', '1.5', 'abc', '']) {
            await expect(service.findCandidates(userId)).rejects.toThrow('positive integer');
        }
        expect(reader.load).not.toHaveBeenCalled();
    });
});

describe('recommendation profile reader', () => {
    function reader(results: unknown[][]) {
        const execute = vi.fn();
        for (const rows of results) execute.mockResolvedValueOnce(rows);
        const orm = { em: { fork: () => ({ execute }) } } as unknown as MikroORM;
        return { profiles: new RecommendationProfileReader(orm), execute };
    }

    it('fails when the active or requested version is unavailable', async () => {
        const missingActive = reader([[]]);
        await expect(missingActive.profiles.load('7')).rejects.toMatchObject({
            code: 'PROFILE_UNAVAILABLE',
            message: 'No active recommendation profile version',
        });
        expect(missingActive.execute.mock.calls[0][0]).toContain('WHERE is_active');

        const missingVersion = reader([[]]);
        await expect(missingVersion.profiles.load('7', 'demo-x')).rejects.toMatchObject({
            code: 'PROFILE_UNAVAILABLE',
            message: 'Recommendation profile version demo-x is missing or not validated',
        });
        expect(missingVersion.execute.mock.calls[0]).toEqual([
            expect.stringContaining('validated_at IS NOT NULL'),
            ['demo-x'],
        ]);
    });

    it('treats a user without rows as having no history and maps top affinities', async () => {
        const version = { version: 'v1', cutoff: '2026-04-01T00:00:00Z', popularity_cutoff: '2026-03-02T00:00:00Z' };
        const empty = reader([[version], [], [], []]);
        await expect(empty.profiles.load('7')).resolves.toEqual(profile({ popularityCutoff: '2026-03-02T00:00:00Z' }));

        const loaded = reader([[version], [{ id: '7', score: 10 }], [{ id: 'premium', score: '4' }], [{ id: '9' }]]);
        await expect(loaded.profiles.load('42', 'v1')).resolves.toEqual(
            profile({
                popularityCutoff: '2026-03-02T00:00:00Z',
                categories: [{ categoryId: '7', score: 10 }],
                tags: [{ tag: 'premium', score: 4 }],
                purchasedProductIds: ['9'],
            })
        );
        expect(loaded.execute.mock.calls.slice(1).map(([, params]) => params)).toEqual([
            ['v1', '42', 5],
            ['v1', '42', 10],
            ['v1', '42'],
        ]);
    });

    it('reads popularity pages after a rank and popularity of specific products', async () => {
        const { profiles, execute } = reader([
            [{ id: '3', popularity_rank: 11, buyer_count: '7' }],
            [{ id: '5', popularity_rank: 2, buyer_count: 40 }],
        ]);

        await expect(profiles.readPopularPage('v1', 10, 5)).resolves.toEqual([
            { productId: '3', popularityRank: 11, buyerCount: 7 },
        ]);
        expect(execute.mock.calls[0]).toEqual([expect.stringContaining('popularity_rank > ?'), ['v1', 10, 5]]);
        await expect(profiles.readPopularity('v1', ['5', '6'])).resolves.toEqual([
            { productId: '5', popularityRank: 2, buyerCount: 40 },
        ]);
        expect(execute.mock.calls[1]).toEqual([expect.stringContaining('product_id IN (?, ?)'), ['v1', '5', '6']]);
        await expect(profiles.readPopularity('v1', [])).resolves.toEqual([]);
        expect(execute).toHaveBeenCalledTimes(2);
    });
});
