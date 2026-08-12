import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';

import { MemberService } from '../application/member.service';
import { MemberType } from './member.type';
import { SignupInput } from './signup.input';
import { SignupPayload } from './signup.payload';

import { AdminGuard } from '~/global/jwt/guard/admin.guard';

@Resolver()
export class MemberResolver {
    constructor(private readonly memberService: MemberService) {}

    @Mutation(() => SignupPayload, { name: 'signup', description: '회원가입' })
    signup(@Args('input') input: SignupInput): Promise<SignupPayload> {
        return this.memberService.signup(input);
    }

    @Query(() => [MemberType], { name: 'members', description: '회원 내역 조회' })
    @UseGuards(AdminGuard)
    async members(): Promise<MemberType[]> {
        const members = await this.memberService.findAll();

        return members.map((member) => ({ ...member, id: member.id.toString() }));
    }
}
