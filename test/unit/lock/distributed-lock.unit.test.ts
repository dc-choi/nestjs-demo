import { Logger } from '@nestjs/common';

import Redlock from 'redlock';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DistributedLockService } from '~/global/common/lock/distributed-lock.service';

describe('DistributedLockService', () => {
    beforeEach(() => {
        vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('락 키를 정렬하고 중복을 제거한 뒤 설정한 횟수만큼 획득을 재시도한다', async () => {
        const unlock = vi.fn().mockResolvedValue(undefined);
        const acquire = vi
            .fn()
            .mockRejectedValueOnce(new Error('lock conflict'))
            .mockRejectedValueOnce(new Error('lock conflict'))
            .mockResolvedValue({ unlock });
        const service = new DistributedLockService({ acquire } as unknown as Redlock);
        const task = vi.fn().mockResolvedValue('done');

        await expect(
            service.run(['lock:item:2', 'lock:item:1', 'lock:item:2'], task, {
                ttl: 30_000,
                maxRetries: 3,
                baseDelay: 0,
            })
        ).resolves.toBe('done');

        expect(acquire).toHaveBeenCalledTimes(3);
        expect(acquire).toHaveBeenCalledWith(['lock:item:1', 'lock:item:2'], 30_000);
        expect(task).toHaveBeenCalledTimes(1);
        expect(unlock).toHaveBeenCalledTimes(1);
    });

    it('락 획득이 끝까지 실패하면 주문 callback을 실행하지 않는다', async () => {
        const acquire = vi.fn().mockRejectedValue(new Error('lock conflict'));
        const service = new DistributedLockService({ acquire } as unknown as Redlock);
        const task = vi.fn();

        await expect(
            service.run(['lock:item:1'], task, {
                ttl: 1_000,
                maxRetries: 2,
                baseDelay: 0,
            })
        ).rejects.toThrow('lock conflict');

        expect(acquire).toHaveBeenCalledTimes(3);
        expect(task).not.toHaveBeenCalled();
    });

    it('주문 callback이 실패해도 락을 해제하고 원본 오류를 유지한다', async () => {
        const unlock = vi.fn().mockResolvedValue(undefined);
        const acquire = vi.fn().mockResolvedValue({ unlock });
        const service = new DistributedLockService({ acquire } as unknown as Redlock);
        const error = new Error('order failed');

        await expect(service.run(['lock:item:1'], async () => Promise.reject(error))).rejects.toBe(error);

        expect(acquire).toHaveBeenCalledTimes(1);
        expect(unlock).toHaveBeenCalledTimes(1);
    });

    it('락 해제 실패가 성공한 주문 결과를 덮어쓰지 않는다', async () => {
        const unlock = vi.fn().mockRejectedValue(new Error('unlock failed'));
        const acquire = vi.fn().mockResolvedValue({ unlock });
        const service = new DistributedLockService({ acquire } as unknown as Redlock);

        await expect(service.run(['lock:item:1'], async () => 'done')).resolves.toBe('done');

        expect(unlock).toHaveBeenCalledTimes(1);
    });
});
