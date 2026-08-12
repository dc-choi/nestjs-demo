import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventBus } from '@nestjs/cqrs';

import { SignupEvent } from './event/signup.event';

import { Prisma } from 'prisma/generated/client/client';
import { MemberRole } from 'prisma/generated/client/enums';
import { REPOSITORY, Repository } from 'prisma/repository';
import { IdBlackList } from '~/api/member/domain/idBlackList';
import { MemberDomain } from '~/api/member/domain/member.domain';
import { ExistingMember, InvalidMember } from '~/global/common/error/member.error';
import { EnvConfig } from '~/global/config/env/env.config';

@Injectable()
export class MemberService {
    constructor(
        @Inject(REPOSITORY) private readonly repository: Repository,
        private readonly config: ConfigService<EnvConfig, true>,
        private readonly eventBus: EventBus
    ) {}

    async signup({ name, password, email, phone }: SignupCommand) {
        const emails = this.config.get<string>('MAIL_SIGNUP_ALERT_USER');
        const salt = this.config.get<string>('SECRET');
        const role = MemberRole.CUSTOMER;

        if (IdBlackList.includes(name)) throw new BadRequestException(new InvalidMember());

        try {
            await this.repository.$primary().member.create({
                data: {
                    name,
                    email,
                    hashedPassword: MemberDomain.generateHashedPassword(password, salt),
                    phone,
                    role,
                },
            });
        } catch (error: unknown) {
            // 사전 조회는 replica 지연과 동시 요청을 막지 못하므로 DB unique 제약을 최종 경계로 사용한다.
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
                throw new ConflictException(new ExistingMember());
            }

            throw error;
        }

        this.eventBus.publish(new SignupEvent(email, name, phone, emails));

        return { name, email, phone, role };
    }

    async findAll() {
        // 목록 조회는 복제 지연을 허용하므로 replica를 사용한다.
        return this.repository
            .$replica()
            .$kysely.selectFrom('members as m')
            .select([
                'm.id as id',
                'm.name as name',
                'm.email as email',
                'm.phone as phone',
                'm.role as role',
                'm.lastLoginAt as lastLoginAt',
                'm.createdAt as createdAt',
            ])
            .where('m.deletedAt', 'is', null)
            .execute()
            .then((results) => results.map((row) => ({ ...row, id: BigInt(row.id) })));
    }
}

interface SignupCommand {
    name: string;
    email: string;
    password: string;
    phone: string;
}
