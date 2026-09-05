import { Writable } from 'node:stream';
import { describe, expect, it, onTestFinished } from 'vitest';
import { createLogger, format, transports } from 'winston';
import { WinstonLoggerService } from '~/global/config/logger/winston-logger.service';

describe('WinstonLoggerService', () => {
    it('keeps structured messages and the Nest context as metadata', () => {
        const { logger, readEntries } = createCapturingLogger();

        logger.log({ type: 'DOMAIN EVENT', aggregateId: 'product-1' }, 'Catalog');

        expect(readEntries()).toEqual([
            {
                level: 'info',
                message: '',
                type: 'DOMAIN EVENT',
                aggregateId: 'product-1',
                context: 'Catalog',
            },
        ]);
    });

    it('keeps error stack and context arguments', () => {
        const { logger, readEntries } = createCapturingLogger();

        logger.error('request failed', 'Error: request failed\n    at resolver.ts:1:1', 'GraphQL');

        expect(readEntries()).toEqual([
            {
                level: 'error',
                message: 'request failed',
                context: 'GraphQL',
                stack: ['Error: request failed\n    at resolver.ts:1:1'],
            },
        ]);
    });

    it('recognizes an error stack when no Nest context is present', () => {
        const { logger, readEntries } = createCapturingLogger();

        logger.error('request failed', 'Error: request failed\n    at resolver.ts:1:1');

        expect(readEntries()).toEqual([
            {
                level: 'error',
                message: 'request failed',
                stack: ['Error: request failed\n    at resolver.ts:1:1'],
            },
        ]);
    });

    it('maps Nest fatal logs without treating optional strings as an error stack', () => {
        const { logger, readEntries } = createCapturingLogger();

        logger.fatal('startup failed', 'detail', 'Bootstrap');

        expect(readEntries()).toEqual([
            {
                level: 'error',
                message: 'startup failed',
                context: 'Bootstrap',
                nestLevel: 'fatal',
                optionalParams: ['detail'],
            },
        ]);
    });
});

function createCapturingLogger() {
    let output = '';
    const stream = new Writable({
        write(chunk, _encoding, callback) {
            output += chunk.toString();
            callback();
        },
    });
    const sink = createLogger({
        format: format.json(),
        transports: [new transports.Stream({ stream })],
    });
    onTestFinished(() => {
        sink.close();
        stream.end();
    });

    return {
        logger: new WinstonLoggerService(sink),
        readEntries: () =>
            output
                .trim()
                .split('\n')
                .map((entry) => JSON.parse(entry)),
    };
}
