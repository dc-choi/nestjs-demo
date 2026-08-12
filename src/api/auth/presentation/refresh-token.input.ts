import { Field, InputType } from '@nestjs/graphql';

import { IsNotEmpty, IsString, IsUUID } from 'class-validator';
import { emptyValue, invalidValue } from '~/global/common/message/error.message';

@InputType()
export class RefreshTokenInput {
    @Field()
    @IsString({ message: invalidValue('accessToken') })
    @IsNotEmpty({ message: emptyValue('accessToken') })
    accessToken: string;

    @Field()
    @IsString({ message: invalidValue('refreshToken') })
    @IsUUID(7, { message: invalidValue('refreshToken') })
    @IsNotEmpty({ message: emptyValue('refreshToken') })
    refreshToken: string;
}
