import { Field, ObjectType } from '@nestjs/graphql';

import { MemberRole } from '~/api/member/presentation/member-role.enum.js';

@ObjectType()
export class LoginPayload {
    @Field()
    accessToken!: string;

    @Field()
    refreshToken!: string;

    @Field(() => MemberRole)
    role!: MemberRole;

    @Field()
    isFirstLogin!: boolean;
}
