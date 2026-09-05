import type { LoggerOptions } from '@mikro-orm/core';

import { describe, expect, it, vi } from 'vitest';
import type { MikroOrmQueryLog } from '~/global/common/logger/channel.logger';
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

    it('uses the standalone ORM writer without exposing query parameters', () => {
        const writer = vi.fn<(message: string) => void>();
        const logger = createMikroOrmLogger({ ...options, writer }, 'test');
        logger.logQuery({ query: 'select * from member where email = ?', params: ['private@example.com'], took: 1 });

        expect(writer).toHaveBeenCalledOnce();
        expect(JSON.parse(writer.mock.calls[0][0])).toMatchObject({ type: 'MIKROORM QUERY', durationMs: 1 });
        expect(writer.mock.calls[0][0]).not.toContain('private@example.com');
    });

    it('SQL parameter를 기록하지 않고 connection 역할을 구조화한다', () => {
        const log = vi.fn<(entry: MikroOrmQueryLog) => void>();
        createMikroOrmLogger(options, 'test', { log });

        writeMikroOrmQueryLog(
            'test',
            {
                query: 'select * from `member` where `email` = ?',
                params: ['secret@example.com'],
                took: 12,
                connection: { type: 'read', name: 'read-replica-1' },
            },
            { log }
        );

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
        const log = vi.fn<(entry: MikroOrmQueryLog) => void>();
        const logger = createMikroOrmLogger(options, 'test', { log });
        const query = 'select * from `product_snapshot`';

        writeMikroOrmQueryLog(
            'test',
            {
                query,
                took: MIKRO_ORM_SLOW_QUERY_THRESHOLD_MS,
                connection: { type: 'write' },
            },
            { log }
        );
        writeMikroOrmQueryLog(
            'test',
            {
                namespace: 'slow-query',
                enabled: true,
                query,
                took: MIKRO_ORM_SLOW_QUERY_THRESHOLD_MS,
                connection: { type: 'write', name: 'primary' },
            },
            { log }
        );

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
