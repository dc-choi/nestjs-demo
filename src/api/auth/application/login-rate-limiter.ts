import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';

import type Redis from 'ioredis';
import { createHash } from 'node:crypto';
import { LoginRateLimited } from '~/global/common/error/auth.error';
import { REDIS_CLIENT } from '~/infra/redis/redis-client.module';

const LOGIN_RATE_LIMIT_WINDOW_SECONDS = 60;
const LOGIN_RATE_LIMIT_PER_ACCOUNT = 5;
const LOGIN_RATE_LIMIT_PER_CLIENT = 10;

const incrementWithExpiry = `
local attempts = redis.call('INCR', KEYS[1])
if attempts == 1 then
    redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return attempts
`;

type RateLimitRedis = Pick<Redis, 'eval'>;

@Injectable()
export class LoginRateLimiter {
    constructor(@Inject(REDIS_CLIENT) private readonly redis: RateLimitRedis) {}

    async assertAllowed(email: string, clientIp: string): Promise<void> {
        const [accountAttempts, clientAttempts] = await Promise.all([
            this.increment(`auth:login:account:${digest(email.trim().toLowerCase())}`),
            this.increment(`auth:login:client:${digest(clientIp)}`),
        ]);

        if (accountAttempts > LOGIN_RATE_LIMIT_PER_ACCOUNT || clientAttempts > LOGIN_RATE_LIMIT_PER_CLIENT) {
            throw new HttpException(new LoginRateLimited(), HttpStatus.TOO_MANY_REQUESTS);
        }
    }

    private async increment(key: string): Promise<number> {
        const attempts = Number(await this.redis.eval(incrementWithExpiry, 1, key, LOGIN_RATE_LIMIT_WINDOW_SECONDS));
        if (!Number.isInteger(attempts)) throw new Error('Unexpected Redis login rate-limit response');

        return attempts;
    }
}

const digest = (value: string): string => createHash('sha256').update(value).digest('base64url');
