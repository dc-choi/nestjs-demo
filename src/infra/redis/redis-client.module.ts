import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { Redis } from 'ioredis';
import { EnvConfig } from '~/global/config/env/env.config.js';
import { REDIS_CLIENT } from '~/infra/redis/redis-client.symbol.js';
import { RedisConnectionLifecycle } from '~/infra/redis/redis-connection.lifecycle.js';

const redisClientProvider = {
    provide: REDIS_CLIENT,
    inject: [ConfigService],
    useFactory: (configService: ConfigService<EnvConfig, true>): Redis =>
        new Redis(configService.get<string>('REDIS_URL')),
};

@Global()
@Module({
    imports: [ConfigModule],
    providers: [redisClientProvider, RedisConnectionLifecycle],
    exports: [REDIS_CLIENT],
})
export class RedisClientModule {}
