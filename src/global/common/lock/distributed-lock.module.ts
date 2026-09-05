import { Global, Module } from '@nestjs/common';

import Redis from 'ioredis';
import Redlock from 'redlock';
import { DistributedLockService } from '~/global/common/lock/distributed-lock.service';
import { RED_LOCK } from '~/global/common/lock/distributed-lock.symbol';
import { REDIS_CLIENT } from '~/infra/redis/redis-client.module';

@Global()
@Module({
    providers: [
        {
            provide: RED_LOCK,
            inject: [REDIS_CLIENT],
            // 획득 시도 횟수와 지연은 호출부 설정을 받는 DistributedLockService 한 곳에서만 제어한다.
            // redlock 4 타입은 ioredis 4의 배열형 eval overload를 고정하지만 ioredis 6도 이를 runtime에서 지원한다.
            useFactory: (redis: Redis) =>
                new Redlock([redis as unknown as Redlock.CompatibleRedisClient], { retryCount: 0 }),
        },
        DistributedLockService,
    ],
    exports: [DistributedLockService],
})
export class DistributedLockModule {}
