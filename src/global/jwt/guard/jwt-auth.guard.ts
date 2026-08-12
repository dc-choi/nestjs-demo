import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

import { JwtPayload } from '../payload/jwt.payload';

import { Request, Response } from 'express';
import { MemberRole } from 'prisma/generated/client/enums';
import { Unauthorized } from '~/global/common/error/auth.error';
import { getRequestFromContext, getResponseFromContext } from '~/global/graphql/graphql-context';

export abstract class JwtAuthGuard extends AuthGuard('jwt') {
    protected readonly allowedRoles?: readonly MemberRole[];

    getRequest(context: ExecutionContext): Request {
        return getRequestFromContext(context);
    }

    getResponse(context: ExecutionContext): Response {
        return getResponseFromContext(context);
    }

    handleRequest<TUser = JwtPayload>(err: unknown, user: JwtPayload | undefined): TUser {
        if (err) throw err;

        if (!user || (this.allowedRoles && !this.allowedRoles.includes(user.role))) {
            throw new UnauthorizedException(new Unauthorized(user?.role));
        }

        return user as TUser;
    }
}
