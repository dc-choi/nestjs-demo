import { ndcgAtK, recallAtK } from '~/infra/search/search-relevance-evaluation.service';

describe('Search relevance metrics', () => {
    it('computes fixed-k ranking quality and recall', () => {
        const judgments = { a: 3, b: 2, c: 1 };
        expect(ndcgAtK(['a', 'b', 'c'], judgments, 10)).toBe(1);
        expect(ndcgAtK(['c', 'b', 'a'], judgments, 10)).toBeLessThan(1);
        expect(recallAtK(['a', 'x'], judgments, 10)).toBeCloseTo(1 / 3);
    });

    it('treats an empty no-match result as correct', () => {
        expect(ndcgAtK([], {}, 10)).toBe(1);
        expect(recallAtK([], {}, 10)).toBe(1);
        expect(ndcgAtK(['unexpected'], {}, 10)).toBe(0);
    });
});
