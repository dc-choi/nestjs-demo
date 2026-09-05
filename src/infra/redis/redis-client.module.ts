import { Global, Inject, Injectable, Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

import Redis from 'ioredis';
import { EnvConfig } from '~/global/config/env/env.config';

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');
export const REDIS_QUIT_TIMEOUT_MS = 5_000;

type RedisConnection = Pick<Redis, 'disconnect' | 'quit'>;

const redisClientProvider = {
    provide: REDIS_CLIENT,
    inject: [ConfigService],
    useFactory: (configService: ConfigService<EnvConfig, true>): Redis =>
        new Redis(configService.get<string>('REDIS_URL')),
};

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

@Global()
@Module({
    imports: [ConfigModule],
    providers: [redisClientProvider, RedisConnectionLifecycle],
    exports: [REDIS_CLIENT],
})
export class RedisClientModule {}
