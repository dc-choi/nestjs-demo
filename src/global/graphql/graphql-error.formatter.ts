import { ApolloServerPlugin } from '@apollo/server';
import { unwrapResolverError } from '@apollo/server/errors';
import { HttpException, Logger } from '@nestjs/common';

import { GraphqlHttpContext } from './graphql-context';

import { GraphQLFormattedError } from 'graphql';
import { ClsServiceManager } from 'nestjs-cls';

const INTERNAL_SERVER_ERROR = 'INTERNAL_SERVER_ERROR';
const graphqlErrorLogger = new Logger('GraphQL');

export const formatGraphqlError = (formattedError: GraphQLFormattedError, error?: unknown): GraphQLFormattedError => {
    const requestId = ClsServiceManager.getClsService().getId();
    const resolverError = unwrapResolverError(error);
    const domainError =
        resolverError instanceof HttpException ? resolverError.getResponse() : formattedError.extensions?.originalError;
    const domainCode = getDomainErrorCode(domainError);
    const domainMessage = getDomainErrorMessage(domainError);
    const formattedCode = formattedError.extensions?.code;
    const code = domainCode ?? (typeof formattedCode === 'string' ? formattedCode : INTERNAL_SERVER_ERROR);
    const extensions: Record<string, unknown> = { code };

    if (requestId) extensions.requestId = requestId;

    return {
        ...formattedError,
        message: code === INTERNAL_SERVER_ERROR ? 'Server Error' : (domainMessage ?? formattedError.message),
        extensions,
    };
};

const getDomainErrorMessage = (domainError: unknown): string | undefined => {
    if (!domainError || typeof domainError !== 'object' || !('message' in domainError)) return undefined;

    const { message } = domainError;
    return typeof message === 'string' ? message : undefined;
};

export const graphqlErrorLoggingPlugin: ApolloServerPlugin<GraphqlHttpContext> = {
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
                    graphqlErrorLogger.error(
                        `${operationName?.slice(0, 128) || 'anonymous'}: ${INTERNAL_SERVER_ERROR}`,
                        frames
                    );
                }
            },
        };
    },
};

const getDomainErrorCode = (originalError: unknown): string | undefined => {
    if (!originalError || typeof originalError !== 'object' || !('type' in originalError)) return undefined;

    const { type } = originalError;
    return typeof type === 'string' && /^[A-Z][A-Z0-9_]*$/.test(type) ? type : undefined;
};
