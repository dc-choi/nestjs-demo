import { jest } from '@jest/globals';
import { type EntityRepository, UniqueConstraintViolationException } from '@mikro-orm/core';
import { ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventBus } from '@nestjs/cqrs';

import { SignupEvent } from '~/api/member/application/event/signup.event';
import { MemberService } from '~/api/member/application/member.service';
import { MemberRole } from '~/api/member/domain/member-role';
import { MemberDomain } from '~/api/member/domain/member.domain';
import { MemberEntity } from '~/api/member/domain/member.entity';
import { EnvConfig } from '~/global/config/env/env.config';

describe('MemberService', () => {
    const command = {
        name: '신규회원',
        email: 'member@example.com',
        password: 'password',
        phone: '01012345678',
    };
    const configValues = {
        MAIL_SIGNUP_ALERT_USER: 'operator@example.com',
        SECRET: 'test-secret',
    };

    function createService(insert: ReturnType<typeof jest.fn>, find = jest.fn()) {
        const repository = {
            insert,
            find,
        } as unknown as EntityRepository<MemberEntity>;
        const config = {
            get: jest.fn((key: keyof typeof configValues) => configValues[key]),
        } as unknown as ConfigService<EnvConfig, true>;
        const eventBus = {
            publish: jest.fn(),
        } as unknown as EventBus;

        return {
            service: new MemberService(repository, config, eventBus),
            eventBus,
            find,
        };
    }

    it('회원 생성 후 가입 이벤트와 CUSTOMER 응답을 반환한다', async () => {
        const insert = jest.fn<() => Promise<bigint>>().mockResolvedValue(1n);
        const { service, eventBus } = createService(insert);

        const result = await service.signup(command);

        expect(insert).toHaveBeenCalledWith({
            name: command.name,
            email: command.email,
            hashedPassword: MemberDomain.generateHashedPassword(command.password, configValues.SECRET),
            phone: command.phone,
            role: MemberRole.CUSTOMER,
        });
        expect(eventBus.publish).toHaveBeenCalledWith(
            new SignupEvent(command.email, command.name, command.phone, configValues.MAIL_SIGNUP_ALERT_USER)
        );
        expect(result).toEqual({
            name: command.name,
            email: command.email,
            phone: command.phone,
            role: MemberRole.CUSTOMER,
        });
    });

    it('DB 이메일 unique 제약 오류를 EXISTING_MEMBER ConflictException으로 변환한다', async () => {
        const error = new UniqueConstraintViolationException(new Error('Duplicate entry'));
        const insert = jest.fn<() => Promise<bigint>>().mockRejectedValue(error);
        const { service, eventBus } = createService(insert);

        const signup = service.signup(command);

        await expect(signup).rejects.toBeInstanceOf(ConflictException);
        await expect(signup).rejects.toMatchObject({
            response: {
                message: '존재하는 사용자입니다.',
                type: 'EXISTING_MEMBER',
            },
        });
        expect(eventBus.publish).not.toHaveBeenCalled();
    });

    it('활성 회원 목록을 replica에서 조회한다', async () => {
        const members = [
            {
                id: 9007199254740993n,
                name: command.name,
                email: command.email,
                phone: command.phone,
                role: MemberRole.CUSTOMER,
                lastLoginAt: null,
                createdAt: new Date('2026-08-13T00:00:00.000Z'),
            },
        ];
        const find = jest.fn<() => Promise<typeof members>>().mockResolvedValue(members);
        const { service } = createService(jest.fn(), find);

        await expect(service.findAll()).resolves.toEqual(members);
        expect(find).toHaveBeenCalledWith(
            { deletedAt: null },
            expect.objectContaining({ connectionType: 'read', disableIdentityMap: true })
        );
    });
});
