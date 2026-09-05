import type { LoggerOptions } from '@mikro-orm/core';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { MikroOrmQueryLog, sqlLog } from '~/global/common/logger/channel.logger';
import {
    MIKRO_ORM_SLOW_QUERY_THRESHOLD_MS,
    createMikroOrmLogger,
    writeMikroOrmQueryLog,
} from '~/infra/database/mikro-orm.logger';

describe('MikroOrmLogger', () => {
    const options = {
        writer: vi.fn(),
        debugMode: ['query'],
        usesReplicas: true,
    } as LoggerOptions;

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('SQL parameter를 기록하지 않고 connection 역할을 구조화한다', () => {
        const log = vi.spyOn(sqlLog, 'log').mockImplementation(() => undefined);
        createMikroOrmLogger(options, 'test');

        writeMikroOrmQueryLog('test', {
            query: 'select * from `member` where `email` = ?',
            params: ['secret@example.com'],
            took: 12,
            connection: { type: 'read', name: 'read-replica-1' },
        });

        expect(log).toHaveBeenCalledTimes(1);
        const entry = log.mock.calls[0][0] as MikroOrmQueryLog;
        expect(entry).toMatchObject({
            type: 'MIKROORM QUERY',
            env: 'test',
            query: 'select * from `member` where `email` = ?',
            durationMs: 12,
            target: 'read-replica-1',
            connectionType: 'read',
            isSlowQuery: false,
        });
        expect(entry).not.toHaveProperty('params');
        expect(JSON.stringify(entry)).not.toContain('secret@example.com');
    });

    it('threshold 이상 쿼리를 slow event 한 건으로 기록한다', () => {
        const log = vi.spyOn(sqlLog, 'log').mockImplementation(() => undefined);
        const logger = createMikroOrmLogger(options, 'test');
        const query = 'select * from `product_snapshot`';

        writeMikroOrmQueryLog('test', {
            query,
            took: MIKRO_ORM_SLOW_QUERY_THRESHOLD_MS,
            connection: { type: 'write' },
        });
        writeMikroOrmQueryLog('test', {
            namespace: 'slow-query',
            enabled: true,
            query,
            took: MIKRO_ORM_SLOW_QUERY_THRESHOLD_MS,
            connection: { type: 'write', name: 'primary' },
        });

        expect(log).toHaveBeenCalledTimes(1);
        expect(log).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'MIKROORM SLOW QUERY',
                isSlowQuery: true,
                slowQueryThresholdMs: MIKRO_ORM_SLOW_QUERY_THRESHOLD_MS,
            })
        );
        expect(logger).toEqual(
            expect.objectContaining({
                logQuery: expect.any(Function),
                isEnabled: expect.any(Function),
            })
        );
    });
});
