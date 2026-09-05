export interface TypedLogger<T> {
    log(entry: T): void;
}

export const APPLICATION_LOGGER = Symbol('APPLICATION_LOGGER');
export const SQL_LOGGER = Symbol('SQL_LOGGER');
export const GRAPHQL_LOGGER = Symbol('GRAPHQL_LOGGER');
export const VERBOSE_LOGGER = Symbol('VERBOSE_LOGGER');

export interface MikroOrmQueryLog {
    type: 'MIKROORM QUERY' | 'MIKROORM SLOW QUERY';
    env: string;
    timestamp: Date;
    query: string;
    durationMs: number;
    target: string;
    connectionType: string;
    isSlowQuery: boolean;
    slowQueryThresholdMs: number;
}

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

export interface VerbosePayload {
    type: string;
    env: string;
    // Additional structured fields are encouraged per-feature
    [key: string]: unknown;
}
