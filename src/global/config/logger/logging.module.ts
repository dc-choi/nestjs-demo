import { Global, Module } from '@nestjs/common';

import { type WinstonLogging, createWinstonLogging } from './winston.config';

import { APPLICATION_LOGGER } from '~/global/common/logger/application-logger.symbol';
import { GRAPHQL_LOGGER } from '~/global/common/logger/graphql-logger.symbol';
import { SQL_LOGGER } from '~/global/common/logger/sql-logger.symbol';
import { VERBOSE_LOGGER } from '~/global/common/logger/verbose-logger.symbol';

const WINSTON_LOGGING = Symbol('WINSTON_LOGGING');

@Global()
@Module({
    providers: [
        { provide: WINSTON_LOGGING, useFactory: () => createWinstonLogging() },
        {
            provide: APPLICATION_LOGGER,
            inject: [WINSTON_LOGGING],
            useFactory: (logging: WinstonLogging) => logging.application,
        },
        {
            provide: SQL_LOGGER,
            inject: [WINSTON_LOGGING],
            useFactory: (logging: WinstonLogging) => logging.sql,
        },
        {
            provide: GRAPHQL_LOGGER,
            inject: [WINSTON_LOGGING],
            useFactory: (logging: WinstonLogging) => logging.graphql,
        },
        {
            provide: VERBOSE_LOGGER,
            inject: [WINSTON_LOGGING],
            useFactory: (logging: WinstonLogging) => logging.verbose,
        },
    ],
    exports: [APPLICATION_LOGGER, SQL_LOGGER, GRAPHQL_LOGGER, VERBOSE_LOGGER],
})
export class LoggingModule {}
