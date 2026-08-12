import { Field, InputType } from '@nestjs/graphql';

import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';
import { emptyValue, invalidMax, invalidValue } from '~/global/common/message/error.message';
import {
    EMAIL_MAX_LENGTH,
    NAME_MAX_LENGTH,
    PASSWORD_MAX_LENGTH,
    PHONE_MAX_LENGTH,
} from '~/global/common/utils/maxLength';
import { EMAIL_REGEXP, NAME_REGEXP, PASSWORD_REGEXP, PHONE_REGEXP } from '~/global/common/utils/regExpPattern';

@InputType()
export class SignupInput {
    @Field()
    @IsString({ message: invalidValue('회원 이름') })
    @IsNotEmpty({ message: emptyValue('회원 이름') })
    @MaxLength(NAME_MAX_LENGTH, { message: invalidMax('회원 이름', NAME_MAX_LENGTH) })
    @Matches(NAME_REGEXP, { message: invalidValue('회원 이름') })
    name: string;

    @Field()
    @IsString({ message: invalidValue('이메일') })
    @IsNotEmpty({ message: emptyValue('이메일') })
    @MaxLength(EMAIL_MAX_LENGTH, { message: invalidMax('이메일', EMAIL_MAX_LENGTH) })
    @Matches(EMAIL_REGEXP, { message: invalidValue('이메일') })
    email: string;

    @Field()
    @IsString({ message: invalidValue('비밀번호') })
    @IsNotEmpty({ message: emptyValue('비밀번호') })
    @MaxLength(PASSWORD_MAX_LENGTH, { message: invalidMax('비밀번호', PASSWORD_MAX_LENGTH) })
    @Matches(PASSWORD_REGEXP, { message: invalidValue('비밀번호') })
    password: string;

    @Field()
    @IsString({ message: invalidValue('연락처') })
    @IsNotEmpty({ message: emptyValue('연락처') })
    @MaxLength(PHONE_MAX_LENGTH, { message: invalidMax('연락처', PHONE_MAX_LENGTH) })
    @Matches(PHONE_REGEXP, { message: invalidValue('연락처') })
    phone: string;
}
