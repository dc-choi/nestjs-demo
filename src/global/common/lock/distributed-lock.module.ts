import { getRedisConnectionToken } from '@nestjs-modules/ioredis';
import { Global, Module } from '@nestjs/common';

import Redis from 'ioredis';
import Redlock from 'redlock';
import { DistributedLockService } from '~/global/common/lock/distributed-lock.service';
import { RED_LOCK } from '~/global/common/lock/distributed-lock.symbol';

@Global()
@Module({
    providers: [
        {
            provide: RED_LOCK,
            inject: [getRedisConnectionToken()],
            // 획득 시도 횟수와 지연은 호출부 설정을 받는 DistributedLockService 한 곳에서만 제어한다.
            useFactory: (redis: Redis) => new Redlock([redis], { retryCount: 0 }),
        },
        DistributedLockService,
    ],
    exports: [DistributedLockService],
})
export class DistributedLockModule {}
