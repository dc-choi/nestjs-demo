import { REDIS_QUIT_TIMEOUT_MS, RedisConnectionLifecycle } from '~/infra/redis/redis-client.module';

describe('RedisConnectionLifecycle', () => {
    afterEach(() => {
        jest.useRealTimers();
    });

    it('quits gracefully when Redis responds', async () => {
        const redis = {
            quit: jest.fn().mockResolvedValue('OK'),
            disconnect: jest.fn(),
        };

        await new RedisConnectionLifecycle(redis).onApplicationShutdown();

        expect(redis.quit).toHaveBeenCalledTimes(1);
        expect(redis.disconnect).not.toHaveBeenCalled();
    });

    it('disconnects when graceful Redis shutdown fails', async () => {
        const redis = {
            quit: jest.fn().mockRejectedValue(new Error('offline')),
            disconnect: jest.fn(),
        };

        await new RedisConnectionLifecycle(redis).onApplicationShutdown();

        expect(redis.disconnect).toHaveBeenCalledTimes(1);
    });

    it('disconnects when graceful Redis shutdown times out', async () => {
        jest.useFakeTimers();
        const redis = {
            quit: jest.fn(() => new Promise<'OK'>(() => undefined)),
            disconnect: jest.fn(),
        };

        const shutdown = new RedisConnectionLifecycle(redis).onApplicationShutdown();
        await jest.advanceTimersByTimeAsync(REDIS_QUIT_TIMEOUT_MS);
        await shutdown;

        expect(redis.disconnect).toHaveBeenCalledTimes(1);
    });
});
