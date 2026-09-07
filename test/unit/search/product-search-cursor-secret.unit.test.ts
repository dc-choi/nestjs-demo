import { ConfigService } from '@nestjs/config';

import { describe, expect, it } from 'vitest';
import { resolveProductSearchCursorSecret } from '~/api/catalog/search/application/product-search-cursor-secret';

describe('Product search cursor secret', () => {
    it('uses the dedicated cursor secret before the application secret', () => {
        expect(
            resolveProductSearchCursorSecret(
                config({
                    OPENSEARCH_ENABLED: true,
                    OPENSEARCH_CURSOR_SECRET: 'dedicated-cursor-secret-at-least-32',
                    SECRET: 'application-secret-at-least-32-char',
                })
            )
        ).toBe('dedicated-cursor-secret-at-least-32');
    });

    it('falls back to the application secret', () => {
        expect(
            resolveProductSearchCursorSecret(
                config({ OPENSEARCH_ENABLED: true, SECRET: 'application-secret-at-least-32-char' })
            )
        ).toBe('application-secret-at-least-32-char');
    });

    it('requires a sufficiently long secret only when search is enabled', () => {
        expect(() => resolveProductSearchCursorSecret(config({ OPENSEARCH_ENABLED: true }))).toThrow(
            'OPENSEARCH_CURSOR_SECRET or SECRET'
        );
        expect(resolveProductSearchCursorSecret(config({ OPENSEARCH_ENABLED: false }))).toBe('search-disabled');
        expect(resolveProductSearchCursorSecret(config({ OPENSEARCH_ENABLED: false, SECRET: 'short' }))).toBe('short');
    });
});

function config(values: Record<string, unknown>): ConfigService {
    return new ConfigService({
        OPENSEARCH_ENABLED: null,
        OPENSEARCH_CURSOR_SECRET: null,
        SECRET: null,
        ...values,
    });
}
