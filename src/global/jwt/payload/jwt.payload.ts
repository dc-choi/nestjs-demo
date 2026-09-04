import type { MemberRole } from '~/api/member/domain/member-role';

export interface JwtClaims {
    memberId: string;
    role: MemberRole;
}

export interface JwtPayload {
    memberId: bigint;
    role: MemberRole;
}
