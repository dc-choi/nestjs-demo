import { Injectable } from '@nestjs/common';

import { RecommendationUnavailableError } from './recommendation-unavailable.error';

import {
    PopularityRow,
    RecommendationProfile,
    RecommendationProfileReader,
} from '~/api/recommendation/infrastructure/recommendation-profile.reader';
import { OpenSearchHttpClient, escapeOpenSearchPathSegment } from '~/infra/search/opensearch.client';
import { SearchConfig } from '~/infra/search/search.config';

export const CANDIDATE_LIMIT = 200;
export const INTEREST_CANDIDATE_LIMIT = 150;
/** Per-request bounds for reading more popularity rows when popular products are missing from the read alias. */
export const POPULARITY_READ_LIMIT = 3;
export const POPULARITY_ROW_LIMIT = 1_000;
/**
 * Popularity rows are products sold before the cutoff, so normally nearly all of them are searchable. When fewer
 * than half are found, the read alias most likely serves another or an empty catalog and candidates would mislead.
 */
export const MIN_POPULAR_FOUND_RATIO = 0.5;

const SOURCE_FIELDS = ['productId', 'slug', 'categoryIds', 'tags', 'minPrice'];
const USER_ID_PATTERN = /^[1-9]\d{0,18}$/;

export type CandidateSource = 'INTEREST' | 'POPULAR';

/** Product document fields that stage 3 ranking uses. */
export interface CandidateDocument {
    productId: string;
    slug: string;
    categoryIds: string[];
    tags: string[];
    minPrice: number;
}

export interface CandidateHit {
    document: CandidateDocument;
    score: number | null;
}

export interface RecommendationCandidate extends CandidateDocument {
    source: CandidateSource;
    /** Position within its source in this result. */
    sourceRank: number;
    /** Interest query `_score`. Popular candidates come from an ids lookup without relevance, so null. */
    searchScore: number | null;
    /** Rank in the profile version's popularity table, not sourceRank. Null without verified buyers. */
    popularityRank: number | null;
    buyerCount: number;
}

export interface RecommendationCandidateResult {
    userId: string;
    profile: RecommendationProfile & { hasHistory: boolean };
    candidates: RecommendationCandidate[];
    diagnostics: {
        readAlias: string;
        interestCount: number;
        popularCount: number;
        /** Purchased products excluded from interest by must_not and from popular by skipping. */
        purchasedExcluded: number;
        popularPurchasedSkipped: number;
        popularDuplicatesSkipped: number;
        popularNotSearchable: number;
        popularityReads: number;
        popularityRowsRead: number;
        shortage: boolean;
        openSearchRequests: number;
    };
}

interface SearchResponse {
    timed_out?: boolean;
    _shards?: { failed?: number };
    hits?: { hits?: SearchHit[] };
}

interface SearchHit {
    _id?: unknown;
    _score?: unknown;
    _source?: Partial<Record<keyof CandidateDocument, unknown>>;
}

interface PopularFill {
    selected: Array<{ document: CandidateDocument; popularity: PopularityRow }>;
    purchasedSkipped: number;
    duplicatesSkipped: number;
    notSearchable: number;
    reads: number;
    rowsRead: number;
}

@Injectable()
export class RecommendationCandidateService {
    constructor(
        private readonly profiles: RecommendationProfileReader,
        private readonly config: SearchConfig,
        private readonly client: OpenSearchHttpClient
    ) {}

    async findCandidates(userId: string, version?: string): Promise<RecommendationCandidateResult> {
        if (!USER_ID_PATTERN.test(userId)) throw new Error('Recommendation user ID must be a positive integer');
        if (!this.config.enabled) {
            throw new RecommendationUnavailableError('SEARCH_DISABLED', 'Recommendation candidate search is disabled');
        }

        const profile = await this.profiles.load(userId, version);
        const purchased = new Set(profile.purchasedProductIds);
        const hasHistory = profile.categories.length > 0 || profile.tags.length > 0;
        let openSearchRequests = 0;
        const search = (body: Record<string, unknown>): Promise<CandidateHit[]> => {
            openSearchRequests += 1;
            return this.search(body);
        };

        const interest = hasHistory ? await search(buildInterestQuery(profile)) : [];
        if (interest.some(({ document }) => purchased.has(document.productId))) {
            throw new RecommendationUnavailableError(
                'SEARCH_UNAVAILABLE',
                'OpenSearch interest response contained a purchased product'
            );
        }
        const interestIds = new Set(interest.map(({ document }) => document.productId));
        const popular = await this.fillPopular(
            profile.version,
            CANDIDATE_LIMIT - interest.length,
            purchased,
            interestIds,
            search
        );
        const interestPopularity = new Map(
            (await this.profiles.readPopularity(profile.version, [...interestIds])).map((row) => [row.productId, row])
        );

        const candidates = [
            ...interest.map(({ document, score }, index) =>
                toCandidate(document, 'INTEREST', index + 1, score, interestPopularity.get(document.productId))
            ),
            ...popular.selected.map(({ document, popularity }, index) =>
                toCandidate(document, 'POPULAR', index + 1, null, popularity)
            ),
        ];
        return {
            userId,
            profile: { ...profile, hasHistory },
            candidates,
            diagnostics: {
                readAlias: this.config.readAlias,
                interestCount: interest.length,
                popularCount: popular.selected.length,
                purchasedExcluded: purchased.size,
                popularPurchasedSkipped: popular.purchasedSkipped,
                popularDuplicatesSkipped: popular.duplicatesSkipped,
                popularNotSearchable: popular.notSearchable,
                popularityReads: popular.reads,
                popularityRowsRead: popular.rowsRead,
                shortage: candidates.length < CANDIDATE_LIMIT,
                openSearchRequests,
            },
        };
    }

    /**
     * Popular products in rank order, skipping purchased and interest products, until `needed` are selected.
     * A page holds enough rows to fill the need if all of them are searchable; missing products lead to the next
     * page, within POPULARITY_READ_LIMIT pages and POPULARITY_ROW_LIMIT rows. The skip counters stop once the
     * selection is full, while the found ratio covers every checked row.
     */
    private async fillPopular(
        version: string,
        needed: number,
        purchased: ReadonlySet<string>,
        interestIds: ReadonlySet<string>,
        search: (body: Record<string, unknown>) => Promise<CandidateHit[]>
    ): Promise<PopularFill> {
        const fill: PopularFill = {
            selected: [],
            purchasedSkipped: 0,
            duplicatesSkipped: 0,
            notSearchable: 0,
            reads: 0,
            rowsRead: 0,
        };
        let afterRank = 0;
        let checked = 0;
        let found = 0;
        while (
            fill.selected.length < needed &&
            fill.reads < POPULARITY_READ_LIMIT &&
            fill.rowsRead < POPULARITY_ROW_LIMIT
        ) {
            // Exact here: a page that leaves the selection short was counted completely.
            const skipsLeft = purchased.size - fill.purchasedSkipped + (interestIds.size - fill.duplicatesSkipped);
            const limit = Math.min(POPULARITY_ROW_LIMIT - fill.rowsRead, needed - fill.selected.length + skipsLeft);
            const page = await this.profiles.readPopularPage(version, afterRank, limit);
            fill.reads += 1;
            fill.rowsRead += page.length;

            const eligible = page.filter(({ productId }) => !purchased.has(productId) && !interestIds.has(productId));
            const documents = new Map<string, CandidateDocument>();
            if (eligible.length > 0) {
                for (const { document } of await search(
                    buildPopularQuery(eligible.map(({ productId }) => productId))
                )) {
                    documents.set(document.productId, document);
                }
                checked += eligible.length;
                found += eligible.filter(({ productId }) => documents.has(productId)).length;
                if (found < checked * MIN_POPULAR_FOUND_RATIO) {
                    throw new RecommendationUnavailableError(
                        'SEARCH_UNAVAILABLE',
                        `Read alias ${this.config.readAlias} returned ${found} of ${checked} popular products; ` +
                            'it may not serve the catalog of the profile version'
                    );
                }
            }
            for (const popularity of page) {
                if (fill.selected.length === needed) break;
                const document = documents.get(popularity.productId);
                if (purchased.has(popularity.productId)) fill.purchasedSkipped += 1;
                else if (interestIds.has(popularity.productId)) fill.duplicatesSkipped += 1;
                else if (!document) fill.notSearchable += 1;
                else fill.selected.push({ document, popularity });
            }
            if (page.length < limit) break;
            afterRank = page[page.length - 1].popularityRank;
        }
        return fill;
    }

    private async search(body: Record<string, unknown>): Promise<CandidateHit[]> {
        try {
            const response = await this.client.request<SearchResponse>(
                'POST',
                `/${escapeOpenSearchPathSegment(this.config.readAlias)}/_search`,
                { query: { allow_partial_search_results: false }, body }
            );
            if (response.timed_out === true || (response._shards?.failed ?? 0) > 0) {
                throw new Error('OpenSearch candidate response was incomplete');
            }
            const hits = response.hits?.hits;
            if (!Array.isArray(hits)) throw new Error('OpenSearch candidate response did not contain hits');
            return rejectRepeatedHits(hits.map(toCandidateHit));
        } catch (error) {
            throw new RecommendationUnavailableError(
                'SEARCH_UNAVAILABLE',
                'Recommendation candidate search is unavailable',
                { cause: error }
            );
        }
    }
}

/**
 * Interest candidates: products in the user's top categories or tags. Each matched term adds its affinity
 * normalized by the strongest affinity of that kind, so `_score` is explainable and has no IDF component.
 */
export function buildInterestQuery(
    profile: Pick<RecommendationProfile, 'categories' | 'tags' | 'purchasedProductIds'>
): Record<string, unknown> {
    const should = [
        ...weightedTerms(
            'categoryIds',
            profile.categories.map(({ categoryId, score }) => [categoryId, score])
        ),
        // `tags` is analyzed text; exact tag values live in the keyword sub-field.
        ...weightedTerms(
            'tags.keyword',
            profile.tags.map(({ tag, score }) => [tag, score])
        ),
    ];
    const mustNot =
        profile.purchasedProductIds.length > 0 ? { must_not: [{ ids: { values: profile.purchasedProductIds } }] } : {};
    return {
        size: INTEREST_CANDIDATE_LIMIT,
        track_total_hits: false,
        _source: SOURCE_FIELDS,
        query: { bool: { should, minimum_should_match: 1, ...mustNot } },
        sort: [{ _score: 'desc' }, { slug: 'asc' }],
    };
}

/** Confirms that popular products exist in the read alias, i.e. are currently searchable. */
export function buildPopularQuery(productIds: readonly string[]): Record<string, unknown> {
    return {
        size: productIds.length,
        track_total_hits: false,
        _source: SOURCE_FIELDS,
        query: { ids: { values: productIds } },
    };
}

function weightedTerms(field: string, terms: Array<[value: string, score: number]>): unknown[] {
    const max = Math.max(...terms.map(([, score]) => score));
    return terms.map(([value, score]) => ({
        constant_score: { filter: { term: { [field]: value } }, boost: score / max },
    }));
}

function toCandidate(
    document: CandidateDocument,
    source: CandidateSource,
    sourceRank: number,
    searchScore: number | null,
    popularity: PopularityRow | undefined
): RecommendationCandidate {
    return {
        ...document,
        source,
        sourceRank,
        searchScore,
        popularityRank: popularity?.popularityRank ?? null,
        buyerCount: popularity?.buyerCount ?? 0,
    };
}

function toCandidateHit(hit: SearchHit): CandidateHit {
    const source = hit._source;
    if (
        typeof hit._id !== 'string' ||
        source?.productId !== hit._id ||
        typeof source.slug !== 'string' ||
        !isStringArray(source.categoryIds) ||
        !isStringArray(source.tags) ||
        typeof source.minPrice !== 'number' ||
        !Number.isFinite(source.minPrice)
    ) {
        throw new Error('OpenSearch candidate hit did not match the product document contract');
    }
    return {
        document: {
            productId: hit._id,
            slug: source.slug,
            categoryIds: source.categoryIds,
            tags: source.tags,
            minPrice: source.minPrice,
        },
        score: typeof hit._score === 'number' ? hit._score : null,
    };
}

/** Interest and popular responses both pass here; one product twice means a broken search response. */
function rejectRepeatedHits(hits: CandidateHit[]): CandidateHit[] {
    if (new Set(hits.map(({ document }) => document.productId)).size !== hits.length) {
        throw new Error('OpenSearch candidate response repeated a product');
    }
    return hits;
}

function isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}
