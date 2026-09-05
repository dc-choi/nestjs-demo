import { Field, ObjectType } from '@nestjs/graphql';

import { MemberRole } from './member-role.enum';

@ObjectType()
export class SignupPayload {
    @Field()
    name!: string;

    @Field()
    email!: string;

    @Field()
    phone!: string;

    @Field(() => MemberRole)
    role!: MemberRole;
}
