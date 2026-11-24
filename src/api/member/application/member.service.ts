import { type EntityRepository, UniqueConstraintViolationException } from '@mikro-orm/core';
import { InjectRepository } from '@mikro-orm/nestjs';
import { BadRequestException, ConflictException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { EventBus } from '@nestjs/cqrs';

import { SignupEvent } from './event/signup.event.js';

import { PasswordKdfBusy } from '~/api/member/application/password-kdf-busy.error.js';
import { PasswordKdfSaturatedError } from '~/api/member/application/password-kdf-saturated.error.js';
import { PasswordService } from '~/api/member/application/password.service.js';
import { MemberRole } from '~/api/member/domain/entity/member-role.js';
import { MemberEntity } from '~/api/member/domain/entity/member.entity.js';
import { ExistingMember } from '~/api/member/domain/existing-member.error.js';
import { InvalidMember } from '~/api/member/domain/invalid-member.error.js';
import { isReservedMemberName } from '~/api/member/domain/member.rules.js';

@Injectable()
export class MemberService {
    constructor(
        @InjectRepository(MemberEntity)
        private readonly repository: EntityRepository<MemberEntity>,
        private readonly passwordService: PasswordService,
        private readonly eventBus: EventBus
    ) {}

    async signup({ name, password, email, phone }: SignupCommand) {
        const role = MemberRole.CUSTOMER;

        if (isReservedMemberName(name)) throw new BadRequestException(new InvalidMember());

        try {
            await this.repository.insert({
                name,
                email,
                hashedPassword: await this.passwordService.hash(password),
                phone,
                role,
            });
        } catch (error: unknown) {
            if (error instanceof PasswordKdfSaturatedError) {
                throw new ServiceUnavailableException(new PasswordKdfBusy());
            }

            // 사전 조회는 replica 지연과 동시 요청을 막지 못하므로 DB unique 제약을 최종 경계로 사용한다.
            if (error instanceof UniqueConstraintViolationException) {
                throw new ConflictException(new ExistingMember());
            }

            throw error;
        }

        this.eventBus.publish(new SignupEvent(email, name, phone));

        return { name, email, phone, role };
    }

    /**
     * 로그인에서 검증한 hash가 아직 저장된 활성 회원만 현재 정책 hash로 바꾼다.
     * 그 사이 비밀번호가 바뀌었거나 탈퇴한 행은 조건에 맞지 않아 덮어쓰지 않는다.
     * KDF 포화는 PasswordKdfSaturatedError로 그대로 던지므로 호출자가 응답 코드를 정한다.
     */
    async upgradePasswordHash(id: bigint, expectedHash: string, password: string): Promise<void> {
        const hashedPassword = await this.passwordService.hash(password);
        await this.repository.nativeUpdate({ id, hashedPassword: expectedHash, deletedAt: null }, { hashedPassword });
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
