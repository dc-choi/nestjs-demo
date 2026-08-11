import { ApiProperty } from '@nestjs/swagger';

import { IsEnum, IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';
import type { Member } from 'prisma/generated/client/client';
import { MemberRole } from 'prisma/generated/client/enums';
import { emptyValue, invalidMax, invalidValue } from '~/global/common/message/error.message';
import {
    EMAIL_MAX_LENGTH,
    NAME_MAX_LENGTH,
    PASSWORD_MAX_LENGTH,
    PHONE_MAX_LENGTH,
} from '~/global/common/utils/maxLength';
import { EMAIL_REGEXP, NAME_REGEXP, PASSWORD_REGEXP, PHONE_REGEXP } from '~/global/common/utils/regExpPattern';

export class SignupRequestDto {
    @ApiProperty({ description: '회원 이름', example: 'username' })
    @IsString({ message: invalidValue('회원 이름') })
    @IsNotEmpty({ message: emptyValue('회원 이름') })
    @MaxLength(NAME_MAX_LENGTH, { message: invalidMax('회원 이름', NAME_MAX_LENGTH) })
    @Matches(NAME_REGEXP, { message: invalidValue('회원 이름') })
    name: string;

    @ApiProperty({ description: '이메일', example: 'qkrwotjd1445@naver.com' })
    @IsString({ message: invalidValue('이메일') })
    @IsNotEmpty({ message: emptyValue('이메일') })
    @MaxLength(EMAIL_MAX_LENGTH, { message: invalidMax('이메일', EMAIL_MAX_LENGTH) })
    @Matches(EMAIL_REGEXP, { message: invalidValue('이메일') })
    email: string;

    @ApiProperty({ description: '비밀번호', example: 'helloWorld' })
    @IsString({ message: invalidValue('비밀번호') })
    @IsNotEmpty({ message: emptyValue('비밀번호') })
    @MaxLength(PASSWORD_MAX_LENGTH, { message: invalidMax('비밀번호', PASSWORD_MAX_LENGTH) })
    @Matches(PASSWORD_REGEXP, { message: invalidValue('비밀번호') })
    password: string;

    @ApiProperty({ description: '연락처', example: '01011111111' })
    @IsString({ message: invalidValue('연락처') })
    @IsNotEmpty({ message: emptyValue('연락처') })
    @MaxLength(PHONE_MAX_LENGTH, { message: invalidMax('연락처', PHONE_MAX_LENGTH) })
    @Matches(PHONE_REGEXP, { message: invalidValue('연락처') })
    phone: string;

    @ApiProperty({ description: '권한', enum: MemberRole, example: MemberRole.GUEST })
    @IsEnum(MemberRole, { message: invalidValue('권한') })
    @IsNotEmpty({ message: emptyValue('권한') })
    role: MemberRole;
}

export class SignupResponseDto {
    @ApiProperty({ description: '회원 이름', example: 'username' })
    name: string;

    @ApiProperty({ description: '이메일', example: 'qkrwotjd1445@naver.com' })
    email: string;

    @ApiProperty({ description: '연락처', example: '01011111111' })
    phone: string;

    @ApiProperty({ description: '권한', enum: MemberRole, example: MemberRole.GUEST })
    role: MemberRole;

    constructor(member?: Member) {
        if (member) {
            this.name = member?.name;
            this.email = member?.email;
            this.phone = member?.phone;
            this.role = member?.role;
        }
    }

    public static toDto(data: Member) {
        return new SignupResponseDto(data);
    }
}
