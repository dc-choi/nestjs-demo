import { Injectable } from '@nestjs/common';

import { JwtAuthGuard } from './jwt-auth.guard';

import { MemberRole } from 'prisma/generated/client/enums';

@Injectable()
export class AdminGuard extends JwtAuthGuard {
    protected readonly allowedRoles = [MemberRole.ADMIN];
}
