import { ConfigService } from '@nestjs/config';

import { describe, expect, it } from 'vitest';
import { SearchConfig } from '~/infra/search/search.config';

describe('Search config', () => {
    it('is inert with safe local defaults when disabled', () => {
        const config = new SearchConfig(createConfigService({ OPENSEARCH_ENABLED: false }));
        expect(config.enabled).toBe(false);
        expect(config.nodeUrl.href).toBe('http://127.0.0.1:9200/');
    });

    it('requires endpoint and aliases when enabled', () => {
        expect(
            () =>
                new SearchConfig(
                    createConfigService({
                        OPENSEARCH_ENABLED: true,
                        SECRET: 'cursor-secret',
                    })
                )
        ).toThrow('OPENSEARCH_NODE_URL is required');
    });

    it('accepts an enabled lazy client configuration', () => {
        const config = new SearchConfig(
            createConfigService({
                OPENSEARCH_ENABLED: true,
                OPENSEARCH_NODE_URL: 'http://127.0.0.1:9200',
                OPENSEARCH_READ_ALIAS: 'catalog-products-read',
                OPENSEARCH_WRITE_ALIAS: 'catalog-products-write',
                OPENSEARCH_CURSOR_SECRET: 'cursor-secret-at-least-32-characters',
            })
        );
        expect(config.enabled).toBe(true);
        expect(config.requestTimeoutMs).toBe(2_000);
    });

    it('rejects a shared read and write alias', () => {
        expect(
            () =>
                new SearchConfig(
                    createConfigService({
                        OPENSEARCH_ENABLED: true,
                        OPENSEARCH_NODE_URL: 'http://127.0.0.1:9200',
                        OPENSEARCH_READ_ALIAS: 'catalog-products',
                        OPENSEARCH_WRITE_ALIAS: 'catalog-products',
                        OPENSEARCH_CURSOR_SECRET: 'cursor-secret-at-least-32-characters',
                    })
                )
        ).toThrow('read and write aliases must be different');
    });
});

function createConfigService(values: Record<string, unknown>): ConfigService {
    // Explicit nulls prevent ConfigService from falling back to the shell environment.
    return new ConfigService({
        OPENSEARCH_ENABLED: null,
        OPENSEARCH_NODE_URL: null,
        OPENSEARCH_READ_ALIAS: null,
        OPENSEARCH_WRITE_ALIAS: null,
        OPENSEARCH_CURSOR_SECRET: null,
        OPENSEARCH_REQUEST_TIMEOUT_MS: null,
        SECRET: null,
        ...values,
    });
}
