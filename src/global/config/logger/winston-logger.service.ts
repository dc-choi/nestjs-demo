import type { LogLevel, LoggerService } from '@nestjs/common';

import type { Logger } from 'winston';

type WinstonLevel = 'debug' | 'error' | 'info' | 'verbose' | 'warn';
type WinstonLogSink = Pick<Logger, 'log'>;

const toWinstonLevel = (level: LogLevel): WinstonLevel => {
    if (level === 'log') return 'info';
    if (level === 'fatal') return 'error';
    return level;
};

const isStackFormat = (value: unknown): value is string =>
    typeof value === 'string' && /^(.)+\n\s+at .+:\d+:\d+/.test(value);

export class WinstonLoggerService implements LoggerService {
    constructor(private readonly logger: WinstonLogSink) {}

    log(message: unknown, ...optionalParams: unknown[]) {
        return this.write('log', message, optionalParams);
    }

    error(message: unknown, ...optionalParams: unknown[]) {
        return this.write('error', message, optionalParams);
    }

    warn(message: unknown, ...optionalParams: unknown[]) {
        return this.write('warn', message, optionalParams);
    }

    debug(message: unknown, ...optionalParams: unknown[]) {
        return this.write('debug', message, optionalParams);
    }

    verbose(message: unknown, ...optionalParams: unknown[]) {
        return this.write('verbose', message, optionalParams);
    }

    fatal(message: unknown, ...optionalParams: unknown[]) {
        return this.write('fatal', message, optionalParams);
    }

    private write(nestLevel: LogLevel, message: unknown, optionalParams: unknown[]) {
        const level = toWinstonLevel(nestLevel);
        const params = [...optionalParams];
        let context: string | undefined;
        let stack: string | undefined;

        if (nestLevel === 'error' && isStackFormat(params.at(-1))) {
            stack = params.pop() as string;
        } else {
            context = typeof params.at(-1) === 'string' ? (params.pop() as string) : undefined;
            stack = nestLevel === 'error' && typeof params.at(-1) === 'string' ? (params.pop() as string) : undefined;
        }

        while (params.length > 0 && params.at(-1) === undefined) params.pop();

        const metadata = {
            ...(nestLevel === 'fatal' ? { nestLevel } : {}),
            ...(context ? { context } : {}),
            ...(stack ? { stack: [stack] } : {}),
            ...(params.length > 0 ? { optionalParams: params } : {}),
        };

        if (message instanceof Error) {
            const errorStack = stack || message.stack;
            return this.logger.log({
                level,
                message: message.message,
                ...(errorStack ? { stack: [errorStack] } : {}),
                error: message,
                ...metadata,
            });
        }

        if (message && typeof message === 'object' && !Array.isArray(message)) {
            const { message: nestedMessage, level: nestedLevel, ...details } = message as Record<string, unknown>;
            const requestedLevel = nestLevel === 'log' && typeof nestedLevel === 'string' ? nestedLevel : level;
            return this.logger.log({
                ...details,
                ...metadata,
                level: requestedLevel === 'log' ? 'info' : requestedLevel,
                message: nestedMessage === undefined ? '' : String(nestedMessage),
            });
        }

        return this.logger.log({ level, message: String(message), ...metadata });
    }
}
