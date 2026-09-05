import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { type LoggerService, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { GraphQLModule } from '@nestjs/graphql';

import { GraphqlHttpContext } from './graphql-context';
import { createGraphqlErrorLoggingPlugin, formatGraphqlError } from './graphql-error.formatter';
import { createGraphqlRequestLoggingPlugin } from './graphql-request-logging.plugin';

import {
    APPLICATION_LOGGER,
    GRAPHQL_LOGGER,
    type GraphqlOperationLog,
    type TypedLogger,
} from '~/global/common/logger/channel.logger';
import { EnvConfig } from '~/global/config/env/env.config';
import { LoggingModule } from '~/global/config/logger/logging.module';

@Module({
    imports: [
        GraphQLModule.forRootAsync<ApolloDriverConfig>({
            driver: ApolloDriver,
            imports: [ConfigModule, LoggingModule],
            inject: [ConfigService, GRAPHQL_LOGGER, APPLICATION_LOGGER],
            useFactory: (
                configService: ConfigService<EnvConfig, true>,
                graphqlLog: TypedLogger<GraphqlOperationLog>,
                applicationLogger: LoggerService
            ) => {
                const isLocal = configService.get<string>('ENV') === 'dev';

                return {
                    autoSchemaFile: true,
                    sortSchema: true,
                    path: '/graphql',
                    graphiql: isLocal,
                    introspection: isLocal,
                    includeStacktraceInErrorResponses: false,
                    maxRecursiveSelections: 1000,
                    plugins: [
                        createGraphqlRequestLoggingPlugin(configService.get<string>('ENV'), graphqlLog),
                        createGraphqlErrorLoggingPlugin(applicationLogger),
                    ],
                    context: ({ req, res }: GraphqlHttpContext): GraphqlHttpContext => ({ req, res }),
                    // HTTP 예외 필터는 Express 응답을 직접 종료하므로 GraphQL 오류 응답 계약과 충돌한다.
                    // resolver 오류의 변환과 기록은 Apollo의 formatError/plugin 경계에서만 처리한다.
                    formatError: formatGraphqlError,
                };
            },
        }),
    ],
})
export class GlobalGraphqlModule {}
