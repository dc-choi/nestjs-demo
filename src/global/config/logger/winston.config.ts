import { inspect } from 'node:util';
import winston from 'winston';
import winstonDaily from 'winston-daily-rotate-file';
import { getCurrentRequestId } from '~/global/common/context/request-context';
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

const createLoggerService = (options: winston.LoggerOptions): WinstonLoggerService =>
    new WinstonLoggerService(winston.createLogger(options));

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

export const verboseLogger = createLoggerService({
    level: 'verbose',
    transports: [createDailyTransport('verbose', 'logs_json/verbose')],
});

export const sqlLogger = createLoggerService({
    level: 'verbose',
    transports: [createDailyTransport('verbose', 'logs_json/sql')],
});

export const graphqlLogger = createLoggerService({
    level: 'http',
    transports: [createDailyTransport('http', 'logs_json/graphql')],
});

const applicationTransports = [
    new winston.transports.Console({
        level: 'debug',
        format: consoleFormat,
    }),
    createDailyTransport('error', 'logs_json/error'),
    createDailyTransport('warn', 'logs_json/warn'),
    createDailyTransport('info', 'logs_json/info'),
];

export const applicationLogger = createLoggerService({ transports: applicationTransports });
