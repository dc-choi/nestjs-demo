import { Inject, Injectable, OnApplicationShutdown } from '@nestjs/common';

import Redis from 'ioredis';
import { REDIS_CLIENT } from '~/infra/redis/redis-client.symbol';

export const REDIS_QUIT_TIMEOUT_MS = 5_000;

type RedisConnection = Pick<Redis, 'disconnect' | 'quit'>;

@Injectable()
export class RedisConnectionLifecycle implements OnApplicationShutdown {
    constructor(@Inject(REDIS_CLIENT) private readonly redis: RedisConnection) {}

    async onApplicationShutdown(): Promise<void> {
        let timeout: NodeJS.Timeout | undefined;

        try {
            await Promise.race([
                this.redis.quit(),
                new Promise<never>((_, reject) => {
                    timeout = setTimeout(() => reject(new Error('Redis quit timed out')), REDIS_QUIT_TIMEOUT_MS);
                }),
            ]);
        } catch {
            this.redis.disconnect();
        } finally {
            if (timeout) clearTimeout(timeout);
        }
    }
}
