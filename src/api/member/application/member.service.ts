import { type EntityRepository, UniqueConstraintViolationException } from '@mikro-orm/core';
import { InjectRepository } from '@mikro-orm/nestjs';
import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventBus } from '@nestjs/cqrs';

import { SignupEvent } from './event/signup.event';

import { IdBlackList } from '~/api/member/domain/idBlackList';
import { MemberRole } from '~/api/member/domain/member-role';
import { MemberDomain } from '~/api/member/domain/member.domain';
import { MemberEntity } from '~/api/member/domain/member.entity';
import { ExistingMember, InvalidMember } from '~/global/common/error/member.error';
import { EnvConfig } from '~/global/config/env/env.config';

@Injectable()
export class MemberService {
    constructor(
        @InjectRepository(MemberEntity)
        private readonly repository: EntityRepository<MemberEntity>,
        private readonly config: ConfigService<EnvConfig, true>,
        private readonly eventBus: EventBus
    ) {}

    async signup({ name, password, email, phone }: SignupCommand) {
        const emails = this.config.get<string>('MAIL_SIGNUP_ALERT_USER');
        const salt = this.config.get<string>('SECRET');
        const role = MemberRole.CUSTOMER;

        if (IdBlackList.includes(name)) throw new BadRequestException(new InvalidMember());

        try {
            await this.repository.insert({
                name,
                email,
                hashedPassword: MemberDomain.generateHashedPassword(password, salt),
                phone,
                role,
            });
        } catch (error: unknown) {
            // 사전 조회는 replica 지연과 동시 요청을 막지 못하므로 DB unique 제약을 최종 경계로 사용한다.
            if (error instanceof UniqueConstraintViolationException) {
                throw new ConflictException(new ExistingMember());
            }

            throw error;
        }

        this.eventBus.publish(new SignupEvent(email, name, phone, emails));

        return { name, email, phone, role };
    }

    async findAll() {
        const members = await this.repository.find(
            { deletedAt: null },
            {
                fields: ['id', 'name', 'email', 'phone', 'role', 'lastLoginAt', 'createdAt'],
                connectionType: 'read',
                disableIdentityMap: true,
            }
        );

        return members.map(({ id, name, email, phone, role, lastLoginAt, createdAt }) => ({
            id,
            name,
            email,
            phone,
            role,
            lastLoginAt,
            createdAt,
        }));
    }
}

interface SignupCommand {
    name: string;
    email: string;
    password: string;
    phone: string;
}
