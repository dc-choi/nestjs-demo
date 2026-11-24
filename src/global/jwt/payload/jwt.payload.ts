import type { MemberRole } from '~/api/member/domain/entity/member-role.js';

export interface JwtClaims {
    memberId: string;
    role: MemberRole;
}

export interface JwtPayload {
    memberId: bigint;
    role: MemberRole;
}
