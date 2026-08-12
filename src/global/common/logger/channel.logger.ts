import { LoggerService } from '@nestjs/common';

import { graphqlLogger, sqlLogger, verboseLogger } from '~/global/config/logger/winston.config';

interface TypedLogger<T> {
    log(entry: T): void;
}

const createTypedLogger = <T>(
    backing: LoggerService,
    method: 'log' | 'verbose' | 'debug' | 'warn' | 'error' = 'log'
): TypedLogger<T> => {
    return {
        log(entry: T) {
            const logger = backing;
            if (method === 'verbose' && typeof logger.verbose === 'function') return logger.verbose(entry);
            if (method === 'debug' && typeof logger.debug === 'function') return logger.debug(entry);
            if (method === 'warn' && typeof logger.warn === 'function') return logger.warn(entry);
            if (method === 'error' && typeof logger.error === 'function') return logger.error(entry);
            return logger.log(entry);
        },
    };
};

// SQL (Prisma) channel
export interface PrismaQueryLog {
    type: 'PRISMA QUERY' | 'PRISMA REPLICA QUERY';
    env: string;
    timestamp: Date;
    query: string;
    durationMs: number;
    target: string;
    isSlowQuery: boolean;
    slowQueryThresholdMs: number;
}

export const sqlLog: TypedLogger<PrismaQueryLog> = createTypedLogger<PrismaQueryLog>(sqlLogger);

export interface GraphqlOperationLog {
    type: 'GRAPHQL OPERATION';
    env: string;
    requestId: string;
    method: string;
    path: string;
    operationType: 'query' | 'mutation' | 'subscription' | 'unknown';
    operationName: string;
    topLevelFields: string[];
    durationMs: number;
    httpStatus: number;
    success: boolean;
    aborted: boolean;
    errorCount: number;
    errorCodes: string[];
}

export const graphqlLog: TypedLogger<GraphqlOperationLog> = createTypedLogger<GraphqlOperationLog>(graphqlLogger);

// Verbose channel (feature teams can further narrow with `createTypedLogger`)
export interface VerbosePayload {
    type: string;
    env: string;
    // Additional structured fields are encouraged per-feature
    [key: string]: unknown;
}

export const verboseLog: TypedLogger<VerbosePayload> = createTypedLogger<VerbosePayload>(verboseLogger, 'verbose');
