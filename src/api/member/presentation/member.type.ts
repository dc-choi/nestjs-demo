import { Field, ID, ObjectType } from '@nestjs/graphql';

import { MemberRole } from './member-role.enum';

@ObjectType('Member')
export class MemberType {
    @Field(() => ID)
    id: string;

    @Field()
    name: string;

    @Field()
    email: string;

    @Field()
    phone: string;

    @Field(() => MemberRole)
    role: MemberRole;

    @Field(() => Date, { nullable: true })
    lastLoginAt: Date | null;

    @Field(() => Date)
    createdAt: Date;
}
