import type { NextFunction, Request, Response } from 'express';
import {
    RequestContextMiddleware,
    getCurrentRequestId,
    runWithRequestContext,
} from '~/global/common/context/request-context';

describe('request context', () => {
    it('keeps concurrent asynchronous request IDs isolated', async () => {
        const readAfterYield = (requestId: string) =>
            runWithRequestContext(requestId, async () => {
                await Promise.resolve();
                return getCurrentRequestId();
            });

        await expect(Promise.all([readAfterYield('request-a'), readAfterYield('request-b')])).resolves.toEqual([
            'request-a',
            'request-b',
        ]);
        expect(getCurrentRequestId()).toBeUndefined();
    });

    it('continues an upstream request ID through the response and handler', () => {
        const request = { header: jest.fn().mockReturnValue('upstream-request') } as unknown as Request;
        const response = { setHeader: jest.fn() } as unknown as Response;
        const next = jest.fn(() => {
            expect(getCurrentRequestId()).toBe('upstream-request');
        }) as NextFunction;

        new RequestContextMiddleware().use(request, response, next);

        expect(response.setHeader).toHaveBeenCalledWith('x-request-id', 'upstream-request');
        expect(next).toHaveBeenCalledTimes(1);
    });

    it('creates a request ID when the upstream header is absent', () => {
        const request = { header: jest.fn().mockReturnValue(undefined) } as unknown as Request;
        const response = { setHeader: jest.fn() } as unknown as Response;
        const next = jest.fn() as NextFunction;

        new RequestContextMiddleware().use(request, response, next);

        expect(response.setHeader).toHaveBeenCalledWith('x-request-id', expect.any(String));
        expect(next).toHaveBeenCalledTimes(1);
    });
});
