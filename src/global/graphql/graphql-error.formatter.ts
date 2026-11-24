import { unwrapResolverError } from '@apollo/server/errors';
import { HttpException } from '@nestjs/common';

import { GraphQLFormattedError } from 'graphql';
import { getCurrentRequestId } from '~/global/common/context/request-context.middleware.js';

export const INTERNAL_SERVER_ERROR = 'INTERNAL_SERVER_ERROR';

export const formatGraphqlError = (formattedError: GraphQLFormattedError, error?: unknown): GraphQLFormattedError => {
    const requestId = getCurrentRequestId();
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

const getDomainErrorCode = (originalError: unknown): string | undefined => {
    if (!originalError || typeof originalError !== 'object' || !('type' in originalError)) return undefined;

    const { type } = originalError;
    return typeof type === 'string' && /^[A-Z][A-Z0-9_]*$/.test(type) ? type : undefined;
};
