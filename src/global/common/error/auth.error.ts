import { MemberRole } from 'prisma/generated/client/enums';

export class Unauthorized {
    constructor(role?: MemberRole) {
        this.role = role;
    }

    message = '인증되지 않았습니다.';

    type = 'UNAUTHORIZED';

    role?: MemberRole | null;
}

export class InvalidIdOrPassword {
    message = '아이디 또는 패스워드가 잘못되었습니다.';

    type = 'INVALID_ID_OR_PASSWORD';
}

export class NotExpiredAccessToken {
    message = '만료된 accessToken이여야 합니다.';

    type = 'NOT_EXPIRED_ACCESS_TOKEN';
}

export class InvalidRefreshToken {
    message = 'refreshToken이 잘못되었습니다.';

    type = 'INVALID_REFRESH_TOKEN';
}
