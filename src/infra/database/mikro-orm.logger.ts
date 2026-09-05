import { DefaultLogger, LogContext, LoggerOptions } from '@mikro-orm/core';

import type { MikroOrmQueryLog, TypedLogger } from '~/global/common/logger/channel.logger';

export const MIKRO_ORM_SLOW_QUERY_THRESHOLD_MS = 500;

export const writeMikroOrmQueryLog = (
    env: string,
    context: { query: string } & LogContext,
    sqlLog: TypedLogger<MikroOrmQueryLog>
): void => {
    const namespace = context.namespace ?? 'query';
    const durationMs = context.took ?? 0;
    const isSlowQuery = namespace === 'slow-query' || durationMs >= MIKRO_ORM_SLOW_QUERY_THRESHOLD_MS;

    // MikroORM emits a second slow-query event for queries over the threshold.
    // Keep one structured record and let that event represent the slow query.
    if (namespace === 'query' && isSlowQuery) return;

    sqlLog.log({
        type: isSlowQuery ? 'MIKROORM SLOW QUERY' : 'MIKROORM QUERY',
        env,
        timestamp: new Date(),
        query: context.query,
        durationMs,
        target: context.connection?.name ?? 'unknown',
        connectionType: context.connection?.type ?? 'unknown',
        isSlowQuery,
        slowQueryThresholdMs: MIKRO_ORM_SLOW_QUERY_THRESHOLD_MS,
    });
};

export const createMikroOrmLogger = (
    options: LoggerOptions,
    env: string,
    sqlLog: TypedLogger<MikroOrmQueryLog> = { log: (entry) => options.writer(JSON.stringify(entry)) }
): DefaultLogger => {
    const logger = new DefaultLogger(options);
    logger.logQuery = (context) => {
        const namespace = context.namespace ?? 'query';
        if (logger.isEnabled(namespace, context)) writeMikroOrmQueryLog(env, context, sqlLog);
    };
    return logger;
};
