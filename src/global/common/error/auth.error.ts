import { ApiProperty } from '@nestjs/swagger';

import { MemberRole } from 'prisma/generated/client/enums';

export class Unauthorized {
    constructor(role?: MemberRole) {
        this.role = role;
    }

    @ApiProperty({ example: '인증되지 않았습니다.' })
    message = '인증되지 않았습니다.';

    @ApiProperty({ example: 'UNAUTHORIZED' })
    type = 'UNAUTHORIZED';

    @ApiProperty({
        examples: [
            MemberRole.GUEST.toString(),
            MemberRole.ADMIN.toString(),
            MemberRole.CUSTOMER.toString(),
            MemberRole.SELLER.toString(),
        ],
    })
    role?: MemberRole | null;
}

export class InvalidIdOrPassword {
    @ApiProperty({ example: '아이디 또는 패스워드가 잘못되었습니다.' })
    message = '아이디 또는 패스워드가 잘못되었습니다.';

    @ApiProperty({ example: 'INVALID_ID_OR_PASSWORD' })
    type = 'INVALID_ID_OR_PASSWORD';
}

export class NotExpiredAccessToken {
    @ApiProperty({ example: '만료된 accessToken이여야 합니다.' })
    message = '만료된 accessToken이여야 합니다.';

    @ApiProperty({ example: 'NOT_EXPIRED_ACCESS_TOKEN' })
    type = 'NOT_EXPIRED_ACCESS_TOKEN';
}

export class InvalidRefreshToken {
    @ApiProperty({ example: 'refreshToken이 잘못되었습니다.' })
    message = 'refreshToken이 잘못되었습니다.';

    @ApiProperty({ example: 'INVALID_REFRESH_TOKEN' })
    type = 'INVALID_REFRESH_TOKEN';
}
