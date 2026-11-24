import { ConfigService } from '@nestjs/config';

import { describe, expect, it } from 'vitest';
import { SearchConfig } from '~/infra/opensearch/search.config.js';

describe('Search config', () => {
    it('is inert with safe local defaults when disabled', () => {
        const config = new SearchConfig(createConfigService({ OPENSEARCH_ENABLED: false }));
        expect(config.enabled).toBe(false);
        expect(config.nodeUrl.href).toBe('http://127.0.0.1:9200/');
    });

    it('requires an endpoint when enabled', () => {
        expect(
            () =>
                new SearchConfig(
                    createConfigService({
                        OPENSEARCH_ENABLED: true,
                    })
                )
        ).toThrow('OPENSEARCH_NODE_URL is required');
    });

    it('owns the runtime defaults for aliases and request timeout', () => {
        // env Joi schema는 기본값을 두지 않으므로 앱과 CLI의 기본값은 이 값이다.
        const config = new SearchConfig(
            createConfigService({
                OPENSEARCH_ENABLED: true,
                OPENSEARCH_NODE_URL: 'http://127.0.0.1:9200',
            })
        );
        expect(config.enabled).toBe(true);
        expect(config.readAlias).toBe('catalog-products-read');
        expect(config.writeAlias).toBe('catalog-products-write');
        expect(config.requestTimeoutMs).toBe(5_000);
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
        OPENSEARCH_REQUEST_TIMEOUT_MS: null,
        ...values,
    });
}
