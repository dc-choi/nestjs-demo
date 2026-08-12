import { Inject, Injectable, Logger } from '@nestjs/common';

import { setTimeout } from 'node:timers/promises';
import Redlock from 'redlock';
import { RED_LOCK } from '~/global/common/lock/distributed-lock.symbol';

export interface DistributedLockOptions {
    readonly ttl: number;
    readonly maxRetries: number;
    readonly baseDelay: number;
}

export const DEFAULT_DISTRIBUTED_LOCK_OPTIONS: DistributedLockOptions = {
    ttl: 30_000,
    maxRetries: 3,
    baseDelay: 100,
};

@Injectable()
export class DistributedLockService {
    private readonly logger = new Logger(DistributedLockService.name);

    constructor(@Inject(RED_LOCK) private readonly redlock: Redlock) {}

    async run<T>(
        resources: readonly string[],
        task: () => Promise<T>,
        options: DistributedLockOptions = DEFAULT_DISTRIBUTED_LOCK_OPTIONS
    ): Promise<T> {
        const lock = await this.acquire([...new Set(resources)].sort(), options);

        try {
            return await task();
        } finally {
            await lock.unlock().catch((error: unknown) => {
                const message = error instanceof Error ? error.message : String(error);
                this.logger.warn(`분산 락 해제 실패: ${message}`);
            });
        }
    }

    private async acquire(resources: string[], options: DistributedLockOptions) {
        const { ttl, maxRetries, baseDelay } = options;

        // maxRetries는 최초 획득 시도 이후의 추가 시도 횟수다. callback 자체는 재시도하지 않는다.
        for (let attempt = 0; ; attempt++) {
            try {
                return await this.redlock.acquire(resources, ttl);
            } catch (error: unknown) {
                if (attempt >= maxRetries) throw error;

                this.logger.warn(`분산 락 획득 재시도 ${attempt + 1}/${maxRetries}`);
                await setTimeout(baseDelay);
            }
        }
    }
}
