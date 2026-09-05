import { afterEach, describe, expect, it, vi } from 'vitest';
import { REDIS_QUIT_TIMEOUT_MS, RedisConnectionLifecycle } from '~/infra/redis/redis-client.module';

describe('RedisConnectionLifecycle', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('quits gracefully when Redis responds', async () => {
        const redis = {
            quit: vi.fn().mockResolvedValue('OK'),
            disconnect: vi.fn(),
        };

        await new RedisConnectionLifecycle(redis).onApplicationShutdown();

        expect(redis.quit).toHaveBeenCalledTimes(1);
        expect(redis.disconnect).not.toHaveBeenCalled();
    });

    it('disconnects when graceful Redis shutdown fails', async () => {
        const redis = {
            quit: vi.fn().mockRejectedValue(new Error('offline')),
            disconnect: vi.fn(),
        };

        await new RedisConnectionLifecycle(redis).onApplicationShutdown();

        expect(redis.disconnect).toHaveBeenCalledTimes(1);
    });

    it('disconnects when graceful Redis shutdown times out', async () => {
        vi.useFakeTimers();
        const redis = {
            quit: vi.fn(() => new Promise<'OK'>(() => undefined)),
            disconnect: vi.fn(),
        };

        const shutdown = new RedisConnectionLifecycle(redis).onApplicationShutdown();
        await vi.advanceTimersByTimeAsync(REDIS_QUIT_TIMEOUT_MS);
        await shutdown;

        expect(redis.disconnect).toHaveBeenCalledTimes(1);
    });
});
