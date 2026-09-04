import { OpenSearchHttpClient, OpenSearchHttpError } from '~/infra/search/opensearch.client';
import { SearchHealthController } from '~/infra/search/search-health.controller';
import { SearchHealthService } from '~/infra/search/search-health.service';
import { SearchConfig } from '~/infra/search/search.config';

describe('Search health', () => {
    it('does not call OpenSearch when disabled', async () => {
        const request = jest.fn();
        const health = new SearchHealthService(
            { enabled: false } as SearchConfig,
            {
                request,
            } as unknown as OpenSearchHttpClient
        );

        await expect(health.check()).resolves.toEqual({ enabled: false, reachable: false });
        expect(request).not.toHaveBeenCalled();
    });

    it('reports an unavailable enabled cluster without throwing', async () => {
        const request = jest.fn(async () => {
            throw new OpenSearchHttpError(null, null, 'connection failed');
        });
        const health = new SearchHealthService(
            { enabled: true } as SearchConfig,
            {
                request,
            } as unknown as OpenSearchHttpClient
        );

        await expect(health.check()).resolves.toEqual({ enabled: true, reachable: false });
    });

    it('exposes disabled search as healthy and unavailable enabled search as 503', async () => {
        const disabled = new SearchHealthController({
            check: jest.fn().mockResolvedValue({ enabled: false, reachable: false }),
        } as unknown as SearchHealthService);
        const unavailable = new SearchHealthController({
            check: jest.fn().mockResolvedValue({ enabled: true, reachable: false }),
        } as unknown as SearchHealthService);

        await expect(disabled.check()).resolves.toEqual({ enabled: false, reachable: false });
        await expect(unavailable.check()).rejects.toMatchObject({ status: 503 });
    });
});
