import { ExecutionContext } from '@nestjs/common';
import { GqlContextType, GqlExecutionContext } from '@nestjs/graphql';

import { Request, Response } from 'express';

export interface GraphqlHttpContext {
    req: Request;
    res: Response;
}

// GraphQL 실행 인수는 root/args/context/info이므로 switchToHttp()로는 실제 request를 얻을 수 없다.
// Passport와 parameter decorator는 Apollo context에 등록한 req/res를 이 helper를 통해 공유한다.
export const isGraphqlContext = (context: ExecutionContext): boolean => {
    return context.getType<GqlContextType>() === 'graphql';
};

export const getRequestFromContext = (context: ExecutionContext): Request => {
    if (isGraphqlContext(context)) {
        return GqlExecutionContext.create(context).getContext<GraphqlHttpContext>().req;
    }

    return context.switchToHttp().getRequest<Request>();
};

export const getResponseFromContext = (context: ExecutionContext): Response => {
    if (isGraphqlContext(context)) {
        return GqlExecutionContext.create(context).getContext<GraphqlHttpContext>().res;
    }

    return context.switchToHttp().getResponse<Response>();
};
