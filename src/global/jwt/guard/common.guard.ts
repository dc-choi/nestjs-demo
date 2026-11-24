import { Injectable } from '@nestjs/common';

import { JwtAuthGuard } from './jwt-auth.guard.js';

import { MemberRole } from '~/api/member/domain/member-role.js';

@Injectable()
export class CommonGuard extends JwtAuthGuard {
    protected readonly allowedRoles = [MemberRole.ADMIN, MemberRole.CUSTOMER, MemberRole.SELLER, MemberRole.GUEST];
}
