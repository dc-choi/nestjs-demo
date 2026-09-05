import { afterEach, describe, expect, it, vi } from 'vitest';
import { CatalogIndexManager } from '~/infra/search/catalog-index.manager';
import { SearchOutboxRelay } from '~/infra/search/search-outbox.relay';
import { SEARCH_OUTBOX_SHUTDOWN_TIMEOUT_MS, SearchOutboxWorker } from '~/infra/search/search-outbox.worker';
import { SearchConfig } from '~/infra/search/search.config';

describe('Search outbox worker', () => {
    afterEach(() => vi.useRealTimers());

    it('does not poll when the worker is disabled', async () => {
        vi.useFakeTimers();
        const drainUntilEmpty = vi.fn();
        const hasAlias = vi.fn();
        const worker = new SearchOutboxWorker(
            { enabled: false } as SearchConfig,
            { drainUntilEmpty } as unknown as SearchOutboxRelay,
            { hasAlias } as unknown as CatalogIndexManager
        );

        worker.onApplicationBootstrap();
        await vi.advanceTimersByTimeAsync(2_000);

        expect(drainUntilEmpty).not.toHaveBeenCalled();
        expect(hasAlias).not.toHaveBeenCalled();
    });

    it('waits for an in-flight poll before shutting down', async () => {
        vi.useFakeTimers();
        let completePoll!: (result: {
            claimed: number;
            processed: number;
            failed: number;
            deadLettered: number;
        }) => void;
        const drainUntilEmpty = vi.fn(
            () =>
                new Promise<{ claimed: number; processed: number; failed: number; deadLettered: number }>((resolve) => {
                    completePoll = resolve;
                })
        );
        const worker = new SearchOutboxWorker(
            { enabled: true, writeAlias: 'catalog-products-write' } as SearchConfig,
            { drainUntilEmpty } as unknown as SearchOutboxRelay,
            { hasAlias: vi.fn(async () => true) } as unknown as CatalogIndexManager
        );

        worker.onApplicationBootstrap();
        vi.advanceTimersByTime(0);
        await Promise.resolve();
        await Promise.resolve();
        expect(drainUntilEmpty).toHaveBeenCalledTimes(1);
        expect(drainUntilEmpty).toHaveBeenCalledWith({
            maxBatches: 20,
            signal: expect.any(AbortSignal),
        });

        let shutdownFinished = false;
        const shutdown = worker.beforeApplicationShutdown().then(() => {
            shutdownFinished = true;
        });
        await Promise.resolve();
        expect(shutdownFinished).toBe(false);

        completePoll({ claimed: 0, processed: 0, failed: 0, deadLettered: 0 });
        await shutdown;
        await vi.advanceTimersByTimeAsync(2_000);
        expect(shutdownFinished).toBe(true);
        expect(drainUntilEmpty).toHaveBeenCalledTimes(1);
    });

    it('aborts a stuck poll and bounds the shutdown wait', async () => {
        vi.useFakeTimers();
        let signal: AbortSignal | undefined;
        const drainUntilEmpty = vi.fn((options: { signal: AbortSignal }) => {
            signal = options.signal;
            return new Promise<never>(() => undefined);
        });
        const worker = new SearchOutboxWorker(
            { enabled: true, writeAlias: 'catalog-products-write' } as SearchConfig,
            { drainUntilEmpty } as unknown as SearchOutboxRelay,
            { hasAlias: vi.fn(async () => true) } as unknown as CatalogIndexManager
        );

        worker.onApplicationBootstrap();
        vi.advanceTimersByTime(0);
        await Promise.resolve();
        await Promise.resolve();

        let shutdownFinished = false;
        const shutdown = worker.beforeApplicationShutdown().then(() => {
            shutdownFinished = true;
        });
        expect(signal?.aborted).toBe(true);

        await vi.advanceTimersByTimeAsync(SEARCH_OUTBOX_SHUTDOWN_TIMEOUT_MS - 1);
        expect(shutdownFinished).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        await shutdown;

        expect(shutdownFinished).toBe(true);
    });

    it('waits without claiming rows, then starts after the write alias exists', async () => {
        vi.useFakeTimers();
        const drainUntilEmpty = vi.fn(async () => ({
            claimed: 0,
            processed: 0,
            failed: 0,
            deadLettered: 0,
        }));
        const hasAlias = vi.fn<() => Promise<boolean>>().mockResolvedValueOnce(false).mockResolvedValue(true);
        const worker = new SearchOutboxWorker(
            { enabled: true, writeAlias: 'catalog-products-write' } as SearchConfig,
            { drainUntilEmpty } as unknown as SearchOutboxRelay,
            { hasAlias } as unknown as CatalogIndexManager
        );

        worker.onApplicationBootstrap();
        await vi.advanceTimersByTimeAsync(0);

        expect(hasAlias).toHaveBeenCalledWith('catalog-products-write');
        expect(drainUntilEmpty).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(1_000);
        expect(drainUntilEmpty).toHaveBeenCalledTimes(1);
        await worker.beforeApplicationShutdown();
    });
});
