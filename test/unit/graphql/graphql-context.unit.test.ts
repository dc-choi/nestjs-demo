import { ExecutionContext } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';

import { Request, Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRequestFromContext, getResponseFromContext, isGraphqlContext } from '~/global/graphql/graphql-context';

describe('GraphQL context helpers', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('GqlExecutionContext의 Apollo context에서 req와 res를 꺼낸다', () => {
        const req = { method: 'POST' } as Request;
        const res = { statusCode: 200 } as Response;
        const getContext = vi.fn().mockReturnValue({ req, res });
        const create = vi.spyOn(GqlExecutionContext, 'create').mockReturnValue({
            getContext,
        } as unknown as GqlExecutionContext);
        const switchToHttp = vi.fn();
        const context = {
            getType: vi.fn().mockReturnValue('graphql'),
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
        const getRequest = vi.fn().mockReturnValue(req);
        const getResponse = vi.fn().mockReturnValue(res);
        const create = vi.spyOn(GqlExecutionContext, 'create');
        const context = {
            getType: vi.fn().mockReturnValue('http'),
            switchToHttp: vi.fn().mockReturnValue({ getRequest, getResponse }),
        } as unknown as ExecutionContext;

        expect(isGraphqlContext(context)).toBe(false);
        expect(getRequestFromContext(context)).toBe(req);
        expect(getResponseFromContext(context)).toBe(res);
        expect(create).not.toHaveBeenCalled();
    });
});
