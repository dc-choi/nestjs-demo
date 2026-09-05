import { WinstonLoggerService } from '~/global/config/logger/winston-logger.service';

describe('WinstonLoggerService', () => {
    it('keeps structured messages and the Nest context as metadata', () => {
        const log = jest.fn();
        const logger = new WinstonLoggerService({ log });

        logger.log({ type: 'DOMAIN EVENT', aggregateId: 'product-1' }, 'Catalog');

        expect(log).toHaveBeenCalledWith({
            level: 'info',
            message: '',
            type: 'DOMAIN EVENT',
            aggregateId: 'product-1',
            context: 'Catalog',
        });
    });

    it('keeps error stack and context arguments', () => {
        const log = jest.fn();
        const logger = new WinstonLoggerService({ log });

        logger.error('request failed', 'Error: request failed\n    at resolver.ts:1:1', 'GraphQL');

        expect(log).toHaveBeenCalledWith({
            level: 'error',
            message: 'request failed',
            context: 'GraphQL',
            stack: ['Error: request failed\n    at resolver.ts:1:1'],
        });
    });

    it('recognizes an error stack when no Nest context is present', () => {
        const log = jest.fn();
        const logger = new WinstonLoggerService({ log });

        logger.error('request failed', 'Error: request failed\n    at resolver.ts:1:1');

        expect(log).toHaveBeenCalledWith({
            level: 'error',
            message: 'request failed',
            stack: ['Error: request failed\n    at resolver.ts:1:1'],
        });
    });

    it('maps Nest fatal logs without treating optional strings as an error stack', () => {
        const log = jest.fn();
        const logger = new WinstonLoggerService({ log });

        logger.fatal('startup failed', 'detail', 'Bootstrap');

        expect(log).toHaveBeenCalledWith({
            level: 'error',
            message: 'startup failed',
            context: 'Bootstrap',
            nestLevel: 'fatal',
            optionalParams: ['detail'],
        });
    });
});
