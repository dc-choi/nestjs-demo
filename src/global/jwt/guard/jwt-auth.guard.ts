import { ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

import { JwtPayload } from '../payload/jwt.payload';

import { Request, Response } from 'express';
import type { MemberRole } from '~/api/member/domain/member-role';
import { Unauthorized } from '~/global/common/error/auth.error';
import { getRequestFromContext, getResponseFromContext } from '~/global/graphql/graphql-context';

@Injectable()
export abstract class JwtAuthGuard extends AuthGuard('jwt') {
    protected readonly allowedRoles?: readonly MemberRole[];

    constructor() {
        super();
    }

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
