import { ExecutionContext, createParamDecorator } from '@nestjs/common';

import { JwtPayload } from '../payload/jwt.payload.js';

import { getRequestFromContext } from '~/global/graphql/graphql-context.js';

export const Jwt = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
    return getRequestFromContext(ctx).user as JwtPayload | undefined;
});
