import { MemberRole } from 'prisma/generated/client/enums';

export interface JwtClaims {
    memberId: string;
    role: MemberRole;
}

export interface JwtPayload {
    memberId: bigint;
    role: MemberRole;
}
