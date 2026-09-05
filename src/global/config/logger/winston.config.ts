import { once } from 'node:events';
import { join } from 'node:path';
import { inspect } from 'node:util';
import winston from 'winston';
import winstonDaily from 'winston-daily-rotate-file';
import { getCurrentRequestId } from '~/global/common/context/request-context';
import type {
    GraphqlOperationLog,
    MikroOrmQueryLog,
    TypedLogger,
    VerbosePayload,
} from '~/global/common/logger/channel.logger';
import { WinstonLoggerService } from '~/global/config/logger/winston-logger.service';

type WinstonLevel = 'debug' | 'error' | 'http' | 'info' | 'verbose' | 'warn';

const nestLikeConsoleFormat = winston.format.printf(({ context, level, message, timestamp, ...metadata }) => {
    const displayedLevel = level === 'info' ? 'LOG' : level.toUpperCase();
    const renderedMessage = message === undefined ? '' : ` ${String(message)}`;
    const renderedContext = context === undefined ? '' : ` [${String(context)}]`;
    const renderedMetadata = Object.keys(metadata).length === 0 ? '' : ` - ${inspect(metadata, { depth: null })}`;

    return `[My-Own-App] ${process.pid} ${String(timestamp)} ${displayedLevel.padStart(7)}${renderedContext}${renderedMessage}${renderedMetadata}`;
});

const consoleFormat = winston.format.combine(winston.format.timestamp(), nestLikeConsoleFormat);

// 요청 컨텍스트가 없는 앱 초기화와 백그라운드 작업 로그에는 requestId가 붙지 않는다.
const addRequestId = winston.format((info) => {
    const requestId = getCurrentRequestId();
    if (info.requestId === undefined && requestId) info.requestId = requestId;
    return info;
});

const createDailyTransport = (level: WinstonLevel, dirname: string) =>
    new winstonDaily({
        level,
        format: winston.format.combine(
            winston.format.timestamp({
                format: 'YYYY-MM-DD HH:mm:ss',
            }),
            addRequestId(),
            winston.format.json()
        ),
        dirname,
        filename: '%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        zippedArchive: false,
        maxSize: '20m',
        maxFiles: '30d',
    });

export interface WinstonLogging {
    application: WinstonLoggerService;
    sql: TypedLogger<MikroOrmQueryLog>;
    graphql: TypedLogger<GraphqlOperationLog>;
    verbose: TypedLogger<VerbosePayload>;
    onApplicationShutdown(): Promise<void>;
}

export function createWinstonLogging(directory = 'logs_json'): WinstonLogging {
    const loggers: winston.Logger[] = [];
    const create = (options: winston.LoggerOptions) => {
        const logger = winston.createLogger(options);
        loggers.push(logger);
        return new WinstonLoggerService(logger);
    };
    const verbose = create({
        level: 'verbose',
        transports: [createDailyTransport('verbose', join(directory, 'verbose'))],
    });
    const sql = create({
        level: 'verbose',
        transports: [createDailyTransport('verbose', join(directory, 'sql'))],
    });
    const graphql = create({
        level: 'http',
        transports: [createDailyTransport('http', join(directory, 'graphql'))],
    });
    const application = create({
        transports: [
            new winston.transports.Console({ level: 'debug', format: consoleFormat }),
            createDailyTransport('error', join(directory, 'error')),
            createDailyTransport('warn', join(directory, 'warn')),
            createDailyTransport('info', join(directory, 'info')),
        ],
    });
    let shutdown: Promise<void> | undefined;

    return {
        application,
        sql,
        graphql,
        verbose: { log: (entry) => verbose.verbose(entry) },
        onApplicationShutdown: () => {
            shutdown ??= Promise.all(
                loggers.map(async (logger) => {
                    const finished = once(logger, 'finish');
                    logger.end();
                    try {
                        await finished;
                    } finally {
                        logger.close();
                    }
                })
            ).then(() => undefined);
            return shutdown;
        },
    };
}
