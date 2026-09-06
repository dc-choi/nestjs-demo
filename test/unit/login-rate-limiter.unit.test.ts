import { HttpException } from '@nestjs/common';

import { describe, expect, it, vi } from 'vitest';
import { LoginRateLimiter } from '~/api/auth/application/login-rate-limiter';

describe('LoginRateLimiter', () => {
    it('increments hashed account and client keys with an expiry', async () => {
        const redis = { eval: vi.fn().mockResolvedValue(1) };
        const limiter = new LoginRateLimiter(redis);

        await expect(limiter.assertAllowed('Member@example.com', '198.51.100.10')).resolves.toBeUndefined();

        expect(redis.eval).toHaveBeenCalledTimes(2);
        for (const [script, keys, key, ttl] of redis.eval.mock.calls) {
            expect(script).toContain("redis.call('INCR'");
            expect(script).toContain("redis.call('EXPIRE'");
            expect(keys).toBe(1);
            expect(key).not.toContain('Member@example.com');
            expect(key).not.toContain('198.51.100.10');
            expect(ttl).toBe(60);
        }
    });

    it.each([
        ['account', 6, 1],
        ['client', 1, 11],
    ])('rejects when the %s attempt limit is exceeded', async (_scope, accountAttempts, clientAttempts) => {
        const redis = {
            eval: vi.fn().mockResolvedValueOnce(accountAttempts).mockResolvedValueOnce(clientAttempts),
        };
        const limiter = new LoginRateLimiter(redis);

        await expect(limiter.assertAllowed('member@example.com', '198.51.100.10')).rejects.toBeInstanceOf(
            HttpException
        );
    });
});
