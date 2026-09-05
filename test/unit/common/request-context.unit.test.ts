import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it } from 'vitest';
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
        const headers = new Map<string, unknown>();
        const request = { header: () => 'upstream-request' } as unknown as Request;
        const response = {
            setHeader: (name: string, value: unknown) => headers.set(name, value),
        } as unknown as Response;
        let nextCalls = 0;
        const next: NextFunction = () => {
            nextCalls += 1;
            expect(getCurrentRequestId()).toBe('upstream-request');
        };

        new RequestContextMiddleware().use(request, response, next);

        expect(headers.get('x-request-id')).toBe('upstream-request');
        expect(nextCalls).toBe(1);
    });

    it('creates a request ID when the upstream header is absent', () => {
        const headers = new Map<string, unknown>();
        const request = { header: () => undefined } as unknown as Request;
        const response = {
            setHeader: (name: string, value: unknown) => headers.set(name, value),
        } as unknown as Response;
        let nextCalls = 0;
        const next: NextFunction = () => {
            nextCalls += 1;
        };

        new RequestContextMiddleware().use(request, response, next);

        expect(headers.get('x-request-id')).toEqual(expect.any(String));
        expect(nextCalls).toBe(1);
    });
});
