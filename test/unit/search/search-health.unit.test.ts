import { ConfigService } from '@nestjs/config';

import { describe, expect, it, vi } from 'vitest';
import { SearchHealthService } from '~/api/search/application/search-health.service.js';
import { SearchHealthController } from '~/api/search/presentation/search-health.controller.js';
import { OpenSearchHttpError } from '~/infra/opensearch/opensearch-http.error.js';
import { OpenSearchHttpClient } from '~/infra/opensearch/opensearch.client.js';
import { OpenSearchConfig } from '~/infra/opensearch/opensearch.config.js';

describe('Search health', () => {
    it('does not call OpenSearch when disabled', async () => {
        const request = vi.fn();
        const health = new SearchHealthService(
            { enabled: false } as OpenSearchConfig,
            {
                request,
            } as unknown as OpenSearchHttpClient
        );

        await expect(health.check()).resolves.toEqual({ enabled: false, reachable: false });
        expect(request).not.toHaveBeenCalled();
    });

    it('reports an unavailable enabled cluster without throwing', async () => {
        const request = vi.fn(async () => {
            throw new OpenSearchHttpError(null, null, 'connection failed');
        });
        const health = new SearchHealthService(
            { enabled: true } as OpenSearchConfig,
            {
                request,
            } as unknown as OpenSearchHttpClient
        );

        await expect(health.check()).resolves.toEqual({ enabled: true, reachable: false });
    });

    it('exposes disabled search as healthy and unavailable enabled search as 503', async () => {
        const disabled = new SearchHealthController(
            new SearchHealthService(createSearchConfig(false), new OpenSearchHttpClient(createSearchConfig(false)))
        );
        const unavailable = new SearchHealthController(
            new SearchHealthService(
                createSearchConfig(true),
                new UnavailableOpenSearchHttpClient(createSearchConfig(true))
            )
        );

        await expect(disabled.check()).resolves.toEqual({ enabled: false, reachable: false });
        await expect(unavailable.check()).rejects.toMatchObject({ status: 503 });
    });
});

class UnavailableOpenSearchHttpClient extends OpenSearchHttpClient {
    override async request<T>(): Promise<T> {
        throw new OpenSearchHttpError(null, null, 'connection failed');
    }
}

function createSearchConfig(enabled: boolean): OpenSearchConfig {
    return new OpenSearchConfig(
        new ConfigService(
            enabled
                ? {
                      OPENSEARCH_ENABLED: true,
                      OPENSEARCH_NODE_URL: 'http://127.0.0.1:9200',
                      OPENSEARCH_READ_ALIAS: 'catalog-products-read',
                      OPENSEARCH_WRITE_ALIAS: 'catalog-products-write',
                  }
                : { OPENSEARCH_ENABLED: false }
        )
    );
}
