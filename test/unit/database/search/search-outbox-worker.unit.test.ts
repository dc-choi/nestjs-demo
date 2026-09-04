import { jest } from '@jest/globals';

import { CatalogIndexManager } from '~/infra/search/catalog-index.manager';
import { SearchOutboxRelay } from '~/infra/search/search-outbox.relay';
import { SearchOutboxWorker } from '~/infra/search/search-outbox.worker';
import { SearchConfig } from '~/infra/search/search.config';

describe('Search outbox worker', () => {
    afterEach(() => jest.useRealTimers());

    it('does not poll when the worker is disabled', async () => {
        jest.useFakeTimers();
        const drainUntilEmpty = jest.fn();
        const hasAlias = jest.fn();
        const worker = new SearchOutboxWorker(
            { enabled: false } as SearchConfig,
            { drainUntilEmpty } as unknown as SearchOutboxRelay,
            { hasAlias } as unknown as CatalogIndexManager
        );

        worker.onApplicationBootstrap();
        await jest.advanceTimersByTimeAsync(2_000);

        expect(drainUntilEmpty).not.toHaveBeenCalled();
        expect(hasAlias).not.toHaveBeenCalled();
    });

    it('does not start the search worker from the inventory expiration CLI', async () => {
        jest.useFakeTimers();
        const originalEntrypoint = process.argv[1];
        const drainUntilEmpty = jest.fn();
        const hasAlias = jest.fn();
        process.argv[1] = '/workspace/dist/src/cli/inventory-expire.js';

        try {
            const worker = new SearchOutboxWorker(
                { enabled: true } as SearchConfig,
                { drainUntilEmpty } as unknown as SearchOutboxRelay,
                { hasAlias } as unknown as CatalogIndexManager
            );
            worker.onApplicationBootstrap();
            await jest.advanceTimersByTimeAsync(2_000);

            expect(drainUntilEmpty).not.toHaveBeenCalled();
            expect(hasAlias).not.toHaveBeenCalled();
        } finally {
            process.argv[1] = originalEntrypoint;
        }
    });

    it('polls immediately, waits for completion and stops cleanly', async () => {
        jest.useFakeTimers();
        const drainUntilEmpty = jest.fn(async () => ({
            claimed: 0,
            processed: 0,
            failed: 0,
            deadLettered: 0,
        }));
        const worker = new SearchOutboxWorker(
            { enabled: true, writeAlias: 'catalog-products-write' } as SearchConfig,
            { drainUntilEmpty } as unknown as SearchOutboxRelay,
            { hasAlias: jest.fn(async () => true) } as unknown as CatalogIndexManager
        );

        worker.onApplicationBootstrap();
        await jest.advanceTimersByTimeAsync(0);
        expect(drainUntilEmpty).toHaveBeenCalledTimes(1);
        expect(drainUntilEmpty).toHaveBeenCalledWith({ maxBatches: 20 });

        worker.onApplicationShutdown();
        await jest.advanceTimersByTimeAsync(2_000);
        expect(drainUntilEmpty).toHaveBeenCalledTimes(1);
    });

    it('waits without claiming rows, then starts after the write alias exists', async () => {
        jest.useFakeTimers();
        const drainUntilEmpty = jest.fn(async () => ({
            claimed: 0,
            processed: 0,
            failed: 0,
            deadLettered: 0,
        }));
        const hasAlias = jest.fn<() => Promise<boolean>>().mockResolvedValueOnce(false).mockResolvedValue(true);
        const worker = new SearchOutboxWorker(
            { enabled: true, writeAlias: 'catalog-products-write' } as SearchConfig,
            { drainUntilEmpty } as unknown as SearchOutboxRelay,
            { hasAlias } as unknown as CatalogIndexManager
        );

        worker.onApplicationBootstrap();
        await jest.advanceTimersByTimeAsync(0);

        expect(hasAlias).toHaveBeenCalledWith('catalog-products-write');
        expect(drainUntilEmpty).not.toHaveBeenCalled();

        await jest.advanceTimersByTimeAsync(1_000);
        expect(drainUntilEmpty).toHaveBeenCalledTimes(1);
        worker.onApplicationShutdown();
    });
});
