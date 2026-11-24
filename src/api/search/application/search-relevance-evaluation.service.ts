import { Injectable } from '@nestjs/common';

import { OpenSearchProductSearchAdapter } from '../infrastructure/opensearch-product-search.adapter.js';

import { performance } from 'node:perf_hooks';
import { ProductSearchInput, canonicalizeProductSearchInput } from '~/api/search/domain/product-search.query.js';

export interface RelevanceEvaluationQuery {
    id: string;
    input: ProductSearchInput;
    judgments: Record<string, number>;
    noMatch?: boolean;
}

export interface RelevanceEvaluationFixture {
    name: string;
    queries: RelevanceEvaluationQuery[];
}

export interface RelevanceQueryResult {
    queryId: string;
    productIds: string[];
    latencyMs: number;
    ndcgAt10: number;
    recallAt10: number;
}

export interface RelevanceIndexResult {
    alias: string;
    ndcgAt10: number;
    recallAt10: number;
    underfillRateAt10: number;
    zeroResultRate: number;
    noMatchFalsePositiveRate: number;
    p95LatencyMs: number;
    queries: RelevanceQueryResult[];
}

export interface RelevanceComparisonResult {
    fixture: string;
    baseline: RelevanceIndexResult;
    candidate: RelevanceIndexResult;
    improvedQueries: string[];
    regressedQueries: string[];
}

@Injectable()
export class SearchRelevanceEvaluationService {
    constructor(private readonly productSearch: OpenSearchProductSearchAdapter) {}

    async compare(
        fixture: RelevanceEvaluationFixture,
        baselineAlias: string,
        candidateAlias: string
    ): Promise<RelevanceComparisonResult> {
        validateFixture(fixture);
        if (baselineAlias === candidateAlias) throw new Error('Baseline and candidate aliases must be different');
        const baseline = await this.evaluateIndex(fixture, baselineAlias);
        const candidate = await this.evaluateIndex(fixture, candidateAlias);
        const candidateByQuery = new Map(candidate.queries.map((query) => [query.queryId, query]));
        const improvedQueries: string[] = [];
        const regressedQueries: string[] = [];
        for (const query of baseline.queries) {
            const delta = (candidateByQuery.get(query.queryId)?.ndcgAt10 ?? 0) - query.ndcgAt10;
            if (delta > 1e-12) improvedQueries.push(query.queryId);
            if (delta < -1e-12) regressedQueries.push(query.queryId);
        }
        return { fixture: fixture.name, baseline, candidate, improvedQueries, regressedQueries };
    }

    async evaluateIndex(fixture: RelevanceEvaluationFixture, alias: string): Promise<RelevanceIndexResult> {
        validateAlias(alias);
        const queries: RelevanceQueryResult[] = [];
        for (const query of fixture.queries) {
            const startedAt = performance.now();
            const productIds = await this.productSearch.searchProductIds(
                alias,
                canonicalizeProductSearchInput({ ...query.input, first: 10, after: null })
            );
            queries.push({
                queryId: query.id,
                productIds,
                latencyMs: performance.now() - startedAt,
                ndcgAt10: ndcgAtK(productIds, query.judgments, 10),
                recallAt10: recallAtK(productIds, query.judgments, 10),
            });
        }

        const noMatchQueries = fixture.queries.filter(({ noMatch }) => noMatch);
        const underfillCandidates = fixture.queries.filter((query) => relevantIds(query.judgments).length >= 10);
        const byId = new Map(queries.map((query) => [query.queryId, query]));
        return {
            alias,
            ndcgAt10: average(queries.map(({ ndcgAt10 }) => ndcgAt10)),
            recallAt10: average(queries.map(({ recallAt10 }) => recallAt10)),
            underfillRateAt10: ratio(
                underfillCandidates.filter((query) => (byId.get(query.id)?.productIds.length ?? 0) < 10).length,
                underfillCandidates.length
            ),
            zeroResultRate: ratio(queries.filter(({ productIds }) => productIds.length === 0).length, queries.length),
            noMatchFalsePositiveRate: ratio(
                noMatchQueries.filter((query) => (byId.get(query.id)?.productIds.length ?? 0) > 0).length,
                noMatchQueries.length
            ),
            p95LatencyMs: percentile(
                queries.map(({ latencyMs }) => latencyMs),
                0.95
            ),
            queries,
        };
    }
}

export function ndcgAtK(productIds: readonly string[], judgments: Readonly<Record<string, number>>, k: number): number {
    const idealGrades = Object.values(judgments)
        .filter((grade) => grade > 0)
        .toSorted((left, right) => right - left)
        .slice(0, k);
    const ideal = discountedGain(idealGrades);
    if (ideal === 0) return productIds.length === 0 ? 1 : 0;
    const actualGrades = productIds.slice(0, k).map((id) => judgments[id] ?? 0);
    return discountedGain(actualGrades) / ideal;
}

export function recallAtK(
    productIds: readonly string[],
    judgments: Readonly<Record<string, number>>,
    k: number
): number {
    const relevant = new Set(relevantIds(judgments));
    if (relevant.size === 0) return productIds.length === 0 ? 1 : 0;
    const found = new Set(productIds.slice(0, k).filter((id) => relevant.has(id)));
    return found.size / relevant.size;
}

function validateFixture(fixture: RelevanceEvaluationFixture): void {
    if (
        !fixture ||
        typeof fixture.name !== 'string' ||
        !Array.isArray(fixture.queries) ||
        fixture.queries.length === 0
    ) {
        throw new Error('Relevance fixture must contain a name and at least one query');
    }
    const ids = new Set<string>();
    for (const query of fixture.queries) {
        if (!query || typeof query.id !== 'string' || query.id === '' || ids.has(query.id)) {
            throw new Error('Relevance fixture query IDs must be non-empty and unique');
        }
        ids.add(query.id);
        if (!query.judgments || Object.values(query.judgments).some((grade) => !Number.isInteger(grade) || grade < 0)) {
            throw new Error(`Relevance fixture query ${query.id} has invalid judgments`);
        }
        canonicalizeProductSearchInput({ ...query.input, first: 10, after: null });
    }
}

function validateAlias(alias: string): void {
    if (!/^[a-z0-9][a-z0-9_-]{0,254}$/.test(alias)) throw new Error(`Invalid evaluation index alias: ${alias}`);
}

function relevantIds(judgments: Readonly<Record<string, number>>): string[] {
    return Object.entries(judgments)
        .filter(([, grade]) => grade > 0)
        .map(([id]) => id);
}

function discountedGain(grades: readonly number[]): number {
    return grades.reduce((sum, grade, index) => sum + (2 ** grade - 1) / Math.log2(index + 2), 0);
}

function average(values: readonly number[]): number {
    return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function ratio(numerator: number, denominator: number): number {
    return denominator === 0 ? 0 : numerator / denominator;
}

function percentile(values: readonly number[], percentileValue: number): number {
    if (values.length === 0) return 0;
    const sorted = values.toSorted((left, right) => left - right);
    return sorted[Math.ceil(sorted.length * percentileValue) - 1] ?? 0;
}
