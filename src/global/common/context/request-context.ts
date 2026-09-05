import { Injectable, NestMiddleware } from '@nestjs/common';

import type { NextFunction, Request, Response } from 'express';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUIDv7 } from 'node:crypto';

interface RequestContext {
    requestId: string;
}

const requestContext = new AsyncLocalStorage<RequestContext>();

export const getCurrentRequestId = (): string | undefined => requestContext.getStore()?.requestId;

export const runWithRequestContext = <T>(requestId: string, callback: () => T): T =>
    requestContext.run({ requestId }, callback);

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
    use(req: Request, res: Response, next: NextFunction): void {
        const requestId = req.header('x-request-id') || randomUUIDv7();

        runWithRequestContext(requestId, () => {
            res.setHeader('x-request-id', requestId);
            next();
        });
    }
}
