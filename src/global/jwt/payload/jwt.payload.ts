import { MemberRole } from 'prisma/generated/client/enums';

export interface JwtPayload {
    memberId: bigint;
    role: MemberRole;
}
