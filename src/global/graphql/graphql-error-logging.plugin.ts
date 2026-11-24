import type { ApolloServerPlugin } from '@apollo/server' with { 'resolution-mode': 'import' };
import { unwrapResolverError } from '@apollo/server/errors';
import { HttpException, type LoggerService } from '@nestjs/common';

import { GraphqlHttpContext } from './graphql-context.js';
import { INTERNAL_SERVER_ERROR } from './graphql-error.formatter.js';

export const createGraphqlErrorLoggingPlugin = (
    logger: Pick<LoggerService, 'error'>
): ApolloServerPlugin<GraphqlHttpContext> => ({
    async requestDidStart() {
        return {
            async didEncounterErrors({ errors, operationName }) {
                for (const error of errors) {
                    const cause = unwrapResolverError(error);
                    if (cause instanceof HttpException && cause.getStatus() < 500) continue;

                    const extensionCode = error.extensions?.code;
                    if (typeof extensionCode === 'string' && extensionCode !== INTERNAL_SERVER_ERROR) continue;

                    // 사용자 입력이 섞인 message와 custom stack line은 버리고 실제 frame만 제한적으로 남긴다.
                    const stack = cause instanceof Error ? cause.stack : error.stack;
                    const frames = stack
                        ?.split('\n')
                        .filter((line) => /^\s*at\s/.test(line))
                        .slice(0, 20)
                        .map((line) => line.slice(0, 500))
                        .join('\n');
                    logger.error(
                        `${operationName?.slice(0, 128) || 'anonymous'}: ${INTERNAL_SERVER_ERROR}`,
                        frames,
                        'GraphQL'
                    );
                }
            },
        };
    },
});
