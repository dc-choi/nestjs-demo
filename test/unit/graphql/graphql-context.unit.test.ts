import { ExecutionContext } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';

import { Request, Response } from 'express';
import { getRequestFromContext, getResponseFromContext, isGraphqlContext } from '~/global/graphql/graphql-context';

describe('GraphQL context helpers', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('GqlExecutionContext의 Apollo context에서 req와 res를 꺼낸다', () => {
        const req = { method: 'POST' } as Request;
        const res = { statusCode: 200 } as Response;
        const getContext = jest.fn().mockReturnValue({ req, res });
        const create = jest.spyOn(GqlExecutionContext, 'create').mockReturnValue({
            getContext,
        } as unknown as GqlExecutionContext);
        const switchToHttp = jest.fn();
        const context = {
            getType: jest.fn().mockReturnValue('graphql'),
            switchToHttp,
        } as unknown as ExecutionContext;

        expect(isGraphqlContext(context)).toBe(true);
        expect(getRequestFromContext(context)).toBe(req);
        expect(getResponseFromContext(context)).toBe(res);
        expect(create).toHaveBeenCalledTimes(2);
        expect(create).toHaveBeenCalledWith(context);
        expect(switchToHttp).not.toHaveBeenCalled();
    });

    it('HTTP context에서는 switchToHttp의 req와 res를 그대로 사용한다', () => {
        const req = { method: 'GET' } as Request;
        const res = { statusCode: 204 } as Response;
        const getRequest = jest.fn().mockReturnValue(req);
        const getResponse = jest.fn().mockReturnValue(res);
        const create = jest.spyOn(GqlExecutionContext, 'create');
        const context = {
            getType: jest.fn().mockReturnValue('http'),
            switchToHttp: jest.fn().mockReturnValue({ getRequest, getResponse }),
        } as unknown as ExecutionContext;

        expect(isGraphqlContext(context)).toBe(false);
        expect(getRequestFromContext(context)).toBe(req);
        expect(getResponseFromContext(context)).toBe(res);
        expect(create).not.toHaveBeenCalled();
    });
});
