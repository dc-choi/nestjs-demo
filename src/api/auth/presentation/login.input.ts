import { Field, InputType } from '@nestjs/graphql';

import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';
import { emptyValue, invalidMax, invalidValue } from '~/global/common/message/error.message';
import { EMAIL_MAX_LENGTH } from '~/global/common/utils/maxLength';
import { EMAIL_REGEXP } from '~/global/common/utils/regExpPattern';

@InputType()
export class LoginInput {
    @Field()
    @IsString({ message: invalidValue('이메일') })
    @IsNotEmpty({ message: emptyValue('이메일') })
    @MaxLength(EMAIL_MAX_LENGTH, { message: invalidMax('이메일', EMAIL_MAX_LENGTH) })
    @Matches(EMAIL_REGEXP, { message: invalidValue('이메일') })
    email: string;

    @Field()
    @IsNotEmpty({ message: emptyValue('비밀번호') })
    @IsString({ message: invalidValue('비밀번호') })
    password: string;
}
