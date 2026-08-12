import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GraphQLModule } from '@nestjs/graphql';

import { GraphqlHttpContext } from './graphql-context';
import { formatGraphqlError, graphqlErrorLoggingPlugin } from './graphql-error.formatter';
import { createGraphqlRequestLoggingPlugin } from './graphql-request-logging.plugin';

import { EnvConfig } from '~/global/config/env/env.config';

@Module({
    imports: [
        GraphQLModule.forRootAsync<ApolloDriverConfig>({
            driver: ApolloDriver,
            inject: [ConfigService],
            useFactory: (configService: ConfigService<EnvConfig, true>) => {
                const isLocal = configService.get<string>('ENV') === 'dev';

                return {
                    autoSchemaFile: true,
                    sortSchema: true,
                    path: '/graphql',
                    graphiql: isLocal,
                    introspection: isLocal,
                    playground: false,
                    includeStacktraceInErrorResponses: false,
                    maxRecursiveSelections: 1000,
                    plugins: [
                        createGraphqlRequestLoggingPlugin(configService.get<string>('ENV')),
                        graphqlErrorLoggingPlugin,
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
