import { MikroORM } from '@mikro-orm/mysql';
import { Injectable } from '@nestjs/common';

import { RecommendationUnavailableError } from '~/api/recommendation/application/recommendation-unavailable.error.js';
import { toNonNegativeInteger, toRequiredString } from '~/global/common/utils/mysql-row.js';

export const PROFILE_CATEGORY_LIMIT = 5;
export const PROFILE_TAG_LIMIT = 10;

export interface RecommendationProfile {
    version: string;
    cutoff: string;
    popularityCutoff: string;
    categories: Array<{ categoryId: string; score: number }>;
    tags: Array<{ tag: string; score: number }>;
    purchasedProductIds: string[];
}

export interface PopularityRow {
    productId: string;
    popularityRank: number;
    buyerCount: number;
}

interface VersionRow {
    version: unknown;
    cutoff: unknown;
    popularity_cutoff: unknown;
}

interface ScoreRow {
    id: unknown;
    score: unknown;
}

interface IdRow {
    id: unknown;
}

interface PopularityDbRow {
    id: unknown;
    popularity_rank: unknown;
    buyer_count: unknown;
}

/** Reads batch output of recommender/aggregate_profiles.sql. Requests never scan rec_events. */
@Injectable()
export class RecommendationProfileReader {
    constructor(private readonly orm: MikroORM) {}

    /**
     * Uses the active version unless one is given. A missing or unvalidated version is an error,
     * while a user without rows in that version simply has no history.
     */
    async load(userId: string, version?: string): Promise<RecommendationProfile> {
        const em = this.orm.em.fork({ useContext: false });
        const select = `SELECT version,
                               DATE_FORMAT(cutoff, '%Y-%m-%dT%H:%i:%sZ') AS cutoff,
                               DATE_FORMAT(popularity_cutoff, '%Y-%m-%dT%H:%i:%sZ') AS popularity_cutoff
                          FROM rec_profile_versions`;
        const [row] =
            version === undefined
                ? await em.execute<VersionRow[]>(`${select} WHERE is_active`)
                : await em.execute<VersionRow[]>(`${select} WHERE version = ? AND validated_at IS NOT NULL`, [version]);
        if (!row) {
            throw new RecommendationUnavailableError(
                'PROFILE_UNAVAILABLE',
                version === undefined
                    ? 'No active recommendation profile version'
                    : `Recommendation profile version ${version} is missing or not validated`
            );
        }

        const resolved = toRequiredString(row.version, 'profile version');
        const key = [resolved, userId];
        const [categories, tags, purchased] = await Promise.all([
            em.execute<ScoreRow[]>(
                `SELECT CAST(category_id AS CHAR) AS id, score
                   FROM rec_user_category_affinity
                  WHERE version = ? AND user_id = ?
                  ORDER BY score DESC, category_id
                  LIMIT ?`,
                [...key, PROFILE_CATEGORY_LIMIT]
            ),
            em.execute<ScoreRow[]>(
                `SELECT tag AS id, score
                   FROM rec_user_tag_affinity
                  WHERE version = ? AND user_id = ?
                  ORDER BY score DESC, tag
                  LIMIT ?`,
                [...key, PROFILE_TAG_LIMIT]
            ),
            em.execute<IdRow[]>(
                `SELECT CAST(product_id AS CHAR) AS id
                   FROM rec_user_purchased_products
                  WHERE version = ? AND user_id = ?
                  ORDER BY product_id`,
                key
            ),
        ]);
        return {
            version: resolved,
            cutoff: toRequiredString(row.cutoff, 'profile cutoff'),
            popularityCutoff: toRequiredString(row.popularity_cutoff, 'popularity cutoff'),
            categories: categories.map((score) => ({
                categoryId: toRequiredString(score.id, 'category id'),
                score: toNonNegativeInteger(score.score, 'category score'),
            })),
            tags: tags.map((score) => ({
                tag: toRequiredString(score.id, 'tag'),
                score: toNonNegativeInteger(score.score, 'tag score'),
            })),
            purchasedProductIds: purchased.map(({ id }) => toRequiredString(id, 'purchased product id')),
        };
    }

    /** Next popularity rows after `afterRank`, in rank order. */
    async readPopularPage(version: string, afterRank: number, limit: number): Promise<PopularityRow[]> {
        const rows = await this.orm.em.fork({ useContext: false }).execute<PopularityDbRow[]>(
            `SELECT CAST(product_id AS CHAR) AS id, popularity_rank, buyer_count
               FROM rec_product_popularity
              WHERE version = ? AND popularity_rank > ?
              ORDER BY popularity_rank
              LIMIT ?`,
            [version, afterRank, limit]
        );
        return rows.map(toPopularityRow);
    }

    /** Popularity of specific products; products without verified buyers have no row. */
    async readPopularity(version: string, productIds: readonly string[]): Promise<PopularityRow[]> {
        if (productIds.length === 0) return [];
        const rows = await this.orm.em.fork({ useContext: false }).execute<PopularityDbRow[]>(
            `SELECT CAST(product_id AS CHAR) AS id, popularity_rank, buyer_count
               FROM rec_product_popularity
              WHERE version = ? AND product_id IN (${productIds.map(() => '?').join(', ')})`,
            [version, ...productIds]
        );
        return rows.map(toPopularityRow);
    }
}

function toPopularityRow(row: PopularityDbRow): PopularityRow {
    return {
        productId: toRequiredString(row.id, 'popular product id'),
        popularityRank: toNonNegativeInteger(row.popularity_rank, 'popularity rank'),
        buyerCount: toNonNegativeInteger(row.buyer_count, 'buyer count'),
    };
}
