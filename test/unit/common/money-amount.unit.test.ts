import { describe, expect, it } from 'vitest';
import { formatMoneyAmount } from '~/global/graphql/money-amount.js';

describe('formatMoneyAmount', () => {
    it.each([
        ['2200', '2200.000'],
        ['12000.5', '12000.500'],
        ['1100.000', '1100.000'],
        ['0.05', '0.050'],
        ['0100.5', '100.500'],
    ])('formats %s as %s', (amount, expected) => {
        expect(formatMoneyAmount(amount)).toBe(expected);
    });

    it.each(['1.2345', 'abc', ''])('rejects %s', (amount) => {
        expect(() => formatMoneyAmount(amount)).toThrow(RangeError);
    });
});
