import type { MemberRole } from '~/api/member/domain/member-role.js';

export class Unauthorized {
    constructor(role?: MemberRole) {
        this.role = role;
    }

    message = '인증되지 않았습니다.';

    type = 'UNAUTHORIZED';

    role?: MemberRole | null;
}
