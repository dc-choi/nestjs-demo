import { Injectable } from '@nestjs/common';

import { JwtAuthGuard } from './jwt-auth.guard';

import { MemberRole } from '~/api/member/domain/member-role';

@Injectable()
export class AdminGuard extends JwtAuthGuard {
    protected readonly allowedRoles = [MemberRole.ADMIN];
}
