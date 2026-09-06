import Redis from 'ioredis';
import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LoginRateLimiter } from '~/api/auth/application/login-rate-limiter';

const enabled = process.env.REDIS_INTEGRATION === '1';
const describeRedis = enabled ? describe : describe.skip;

describeRedis('LoginRateLimiter Redis integration', () => {
    let firstRedis: Redis | undefined;
    let secondRedis: Redis | undefined;

    beforeAll(async () => {
        const options = {
            connectTimeout: 2_000,
            maxRetriesPerRequest: 0,
            retryStrategy: () => null,
        };
        const first = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379', options);
        const second = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379', options);

        await Promise.all([first.ping(), second.ping()]);
        firstRedis = first;
        secondRedis = second;
    });

    afterAll(async () => {
        await Promise.all([firstRedis?.quit(), secondRedis?.quit()]);
    });

    it('shares the exact account threshold between limiter instances and hashes normalized identifiers', async () => {
        const namespace = randomUUID();
        const email = `${namespace}@example.test`;
        const clientIp = `client-${randomUUID()}`;
        const accountKey = accountRateLimitKey(email);
        const clientKey = clientRateLimitKey(clientIp);

        try {
            const [firstLimiter, secondLimiter] = limiters();
            await firstLimiter.assertAllowed(` ${email.toUpperCase()} `, clientIp);
            await secondLimiter.assertAllowed(email, clientIp);

            const attempts = await Promise.allSettled(
                Array.from({ length: 4 }, (_, index) =>
                    (index % 2 === 0 ? firstLimiter : secondLimiter).assertAllowed(email, clientIp)
                )
            );

            expect(fulfilled(attempts)).toHaveLength(3);
            expect(rateLimited(attempts)).toHaveLength(1);
            expect(await getRedis().get(accountKey)).toBe('6');
            expect(await getRedis().ttl(accountKey)).toBeGreaterThan(0);
            expect(await getRedis().ttl(accountKey)).toBeLessThanOrEqual(60);
            expect(accountKey).not.toContain(email);
            expect(clientKey).not.toContain(clientIp);
            expect(await getRedis().get(`auth:login:account:${email}`)).toBeNull();
        } finally {
            await getRedis().del(accountKey, clientKey);
        }
    });

    it('shares the exact client threshold between limiter instances under concurrent distinct-account attempts', async () => {
        const namespace = randomUUID();
        const clientIp = `client-${randomUUID()}`;
        const clientKey = clientRateLimitKey(clientIp);
        const accountKeys = Array.from({ length: 11 }, (_, index) =>
            accountRateLimitKey(`${namespace}-${index}@example.test`)
        );

        try {
            const [firstLimiter, secondLimiter] = limiters();
            const attempts = await Promise.allSettled(
                Array.from({ length: 11 }, (_, index) => {
                    const limiter = index % 2 === 0 ? firstLimiter : secondLimiter;
                    return limiter.assertAllowed(`${namespace}-${index}@example.test`, clientIp);
                })
            );

            expect(fulfilled(attempts)).toHaveLength(10);
            expect(rateLimited(attempts)).toHaveLength(1);
            expect(await getRedis().get(clientKey)).toBe('11');
            expect(await getRedis().ttl(clientKey)).toBeGreaterThan(0);
        } finally {
            await getRedis().del(clientKey, ...accountKeys);
        }
    });

    function limiters(): [LoginRateLimiter, LoginRateLimiter] {
        return [new LoginRateLimiter(getRedis()), new LoginRateLimiter(getSecondRedis())];
    }

    function getRedis(): Redis {
        if (!firstRedis) throw new Error('First Redis integration client is unavailable');
        return firstRedis;
    }

    function getSecondRedis(): Redis {
        if (!secondRedis) throw new Error('Second Redis integration client is unavailable');
        return secondRedis;
    }
});

function fulfilled(results: PromiseSettledResult<void>[]): PromiseFulfilledResult<void>[] {
    return results.filter((result): result is PromiseFulfilledResult<void> => result.status === 'fulfilled');
}

function rateLimited(results: PromiseSettledResult<void>[]): PromiseRejectedResult[] {
    return results.filter(
        (result): result is PromiseRejectedResult =>
            result.status === 'rejected' &&
            result.reason instanceof Error &&
            'getStatus' in result.reason &&
            typeof result.reason.getStatus === 'function' &&
            result.reason.getStatus() === 429
    );
}

function accountRateLimitKey(email: string): string {
    return `auth:login:account:${digest(email.trim().toLowerCase())}`;
}

function clientRateLimitKey(clientIp: string): string {
    return `auth:login:client:${digest(clientIp)}`;
}

function digest(value: string): string {
    return createHash('sha256').update(value).digest('base64url');
}
