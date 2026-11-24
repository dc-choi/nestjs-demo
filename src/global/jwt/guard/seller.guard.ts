import { Injectable } from '@nestjs/common';

import { JwtAuthGuard } from './jwt-auth.guard.js';

import { MemberRole } from '~/api/member/domain/member-role.js';

@Injectable()
export class SellerGuard extends JwtAuthGuard {
    protected readonly allowedRoles = [MemberRole.ADMIN, MemberRole.SELLER];
}
