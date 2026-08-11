import { ApiProperty } from '@nestjs/swagger';

import type { Member } from 'prisma/generated/client/client';
import { MemberRole } from 'prisma/generated/client/enums';

export class FindAllMemberResponseDto {
    @ApiProperty({ description: '회원 ID', example: 1 })
    id: bigint;

    @ApiProperty({ description: '회원 이름', example: 'username' })
    name: string;

    @ApiProperty({ description: '이메일', example: 'qkrwotjd1445@naver.com' })
    email: string;

    @ApiProperty({ description: '연락처', example: '01011111111' })
    phone: string;

    @ApiProperty({ description: '권한', enum: MemberRole, example: MemberRole.GUEST })
    role: MemberRole;

    @ApiProperty({ description: '마지막 로그인 시간', example: '2021-09-01T00:00:00' })
    lastLoginAt: Date | null;

    @ApiProperty({ description: '회원 가입 시간', example: '2021-09-01T00:00:00' })
    createdAt: Date;

    constructor(data: Pick<Member, 'id' | 'name' | 'email' | 'phone' | 'role' | 'lastLoginAt' | 'createdAt'>) {
        if (data) {
            this.id = data?.id;
            this.name = data?.name;
            this.email = data?.email;
            this.phone = data?.phone;
            this.role = data?.role;
            this.lastLoginAt = data?.lastLoginAt;
            this.createdAt = data?.createdAt;
        }
    }

    public static toDto(
        data: Pick<Member, 'id' | 'name' | 'email' | 'phone' | 'role' | 'lastLoginAt' | 'createdAt'>[]
    ) {
        return data.map((item) => new FindAllMemberResponseDto(item));
    }
}
