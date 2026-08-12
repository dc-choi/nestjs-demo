import { WinstonModule, utilities } from 'nest-winston';
import { ClsServiceManager } from 'nestjs-cls';
import winston from 'winston';
import winstonDaily from 'winston-daily-rotate-file';

// CLS가 활성화된 요청에서 이 format을 사용하는 로그에만 requestId가 붙는다.
// 앱 초기화와 백그라운드 작업, console transport에는 requestId가 없을 수 있다.
const addRequestId = winston.format((info) => {
    const cls = ClsServiceManager.getClsService();
    const requestId = cls.getId();
    if (requestId) {
        info.requestId = requestId;
    }
    return info;
});

export const verboseLogger = WinstonModule.createLogger({
    level: 'verbose',
    format: winston.format.combine(winston.format.timestamp(), utilities.format.nestLike('My-Own-App')),
    transports: [
        new winstonDaily({
            level: 'verbose',
            format: winston.format.combine(
                winston.format.timestamp({
                    format: 'YYYY-MM-DD HH:mm:ss',
                }),
                addRequestId(),
                winston.format.json()
            ),
            dirname: 'logs_json/verbose',
            filename: '%DATE%.log',
            datePattern: 'YYYY-MM-DD',
            zippedArchive: false,
            maxSize: '20m',
            maxFiles: '30d',
        }),
    ],
});

export const sqlLogger = WinstonModule.createLogger({
    level: 'verbose',
    format: winston.format.combine(winston.format.timestamp(), utilities.format.nestLike('My-Own-App')),
    transports: [
        new winstonDaily({
            level: 'verbose',
            format: winston.format.combine(
                winston.format.timestamp({
                    format: 'YYYY-MM-DD HH:mm:ss',
                }),
                addRequestId(),
                winston.format.json()
            ),
            dirname: 'logs_json/sql',
            filename: '%DATE%.log',
            datePattern: 'YYYY-MM-DD',
            zippedArchive: false,
            maxSize: '20m',
            maxFiles: '30d',
        }),
    ],
});

export const graphqlLogger = WinstonModule.createLogger({
    level: 'http',
    format: winston.format.combine(winston.format.timestamp(), utilities.format.nestLike('My-Own-App')),
    transports: [
        new winstonDaily({
            level: 'http',
            format: winston.format.combine(
                winston.format.timestamp({
                    format: 'YYYY-MM-DD HH:mm:ss',
                }),
                winston.format.json()
            ),
            dirname: 'logs_json/graphql',
            filename: '%DATE%.log',
            datePattern: 'YYYY-MM-DD',
            zippedArchive: false,
            maxSize: '20m',
            maxFiles: '30d',
        }),
    ],
});

export const winstonTransports = [
    new winston.transports.Console({
        level: 'debug',
        format: winston.format.combine(winston.format.timestamp(), utilities.format.nestLike('My-Own-App')),
    }),
    new winstonDaily({
        level: 'error',
        format: winston.format.combine(
            winston.format.timestamp({
                format: 'YYYY-MM-DD HH:mm:ss',
            }),
            addRequestId(),
            winston.format.json()
        ),
        dirname: 'logs_json/error',
        filename: '%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        zippedArchive: false,
        maxSize: '20m',
        maxFiles: '30d',
    }),
    new winstonDaily({
        level: 'warn',
        format: winston.format.combine(
            winston.format.timestamp({
                format: 'YYYY-MM-DD HH:mm:ss',
            }),
            addRequestId(),
            winston.format.json()
        ),
        dirname: 'logs_json/warn',
        filename: '%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        zippedArchive: false,
        maxSize: '20m',
        maxFiles: '30d',
    }),
    new winstonDaily({
        level: 'info',
        format: winston.format.combine(
            winston.format.timestamp({
                format: 'YYYY-MM-DD HH:mm:ss',
            }),
            addRequestId(),
            winston.format.json()
        ),
        dirname: 'logs_json/info',
        filename: '%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        zippedArchive: false,
        maxSize: '20m',
        maxFiles: '30d',
    }),
];
