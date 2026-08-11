import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

import { MemberRole } from 'prisma/generated/client/enums';
import { Unauthorized } from '~/global/common/error/auth.error';

@Injectable()
export class CommonGuard extends AuthGuard('jwt') {
    handleRequest(err: any, user: any) {
        if (err) throw err;

        if (
            !user ||
            (user.role !== MemberRole.ADMIN &&
                user.role !== MemberRole.CUSTOMER &&
                user.role !== MemberRole.SELLER &&
                user.role !== MemberRole.GUEST)
        ) {
            throw new UnauthorizedException(new Unauthorized(user.role));
        }

        return user;
    }
}
