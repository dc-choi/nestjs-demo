import { ApiProperty } from '@nestjs/swagger';

import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';
import { MemberRole } from 'prisma/generated/client/enums';
import { emptyValue, invalidMax, invalidValue } from '~/global/common/message/error.message';
import { EMAIL_MAX_LENGTH } from '~/global/common/utils/maxLength';
import { EMAIL_REGEXP } from '~/global/common/utils/regExpPattern';

export class LoginRequestDto {
    @ApiProperty({ description: '이메일', example: 'qkrwotjd1445@naver.com' })
    @IsString({ message: invalidValue('이메일') })
    @IsNotEmpty({ message: emptyValue('이메일') })
    @MaxLength(EMAIL_MAX_LENGTH, { message: invalidMax('이메일', EMAIL_MAX_LENGTH) })
    @Matches(EMAIL_REGEXP, { message: invalidValue('이메일') })
    email: string;

    @ApiProperty({ description: '비밀번호', example: 'helloWorld' })
    @IsNotEmpty({ message: emptyValue('비밀번호') })
    @IsString({ message: invalidValue('비밀번호') })
    password: string;
}

export class LoginResponseDto {
    @ApiProperty({ description: 'accessToken 값' })
    accessToken: string;

    @ApiProperty({ description: 'refreshToken 값' })
    refreshToken: string;

    @ApiProperty({ description: '사용자의 권한', example: MemberRole.GUEST })
    role: MemberRole;

    @ApiProperty({ description: '첫 로그인 여부', example: true })
    isFirstLogin: boolean;

    constructor(data?: ILoginProps) {
        if (data) {
            this.accessToken = data.accessToken;
            this.refreshToken = data.refreshToken;
            this.role = data.role;
            this.isFirstLogin = data.isFirstLogin;
        }
    }

    public static toDto(data: ILoginProps) {
        return new LoginResponseDto(data);
    }
}

interface ILoginProps {
    accessToken: string;
    refreshToken: string;
    role: MemberRole;
    isFirstLogin: boolean;
}
