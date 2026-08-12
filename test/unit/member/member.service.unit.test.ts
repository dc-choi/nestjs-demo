import { ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventBus } from '@nestjs/cqrs';

import { Prisma } from 'prisma/generated/client/client';
import { MemberRole } from 'prisma/generated/client/enums';
import { Repository } from 'prisma/repository';
import { SignupEvent } from '~/api/member/application/event/signup.event';
import { MemberService } from '~/api/member/application/member.service';
import { MemberDomain } from '~/api/member/domain/member.domain';
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

    function createService(create: jest.Mock) {
        const primary = { member: { create } };
        const repository = {
            $primary: jest.fn(() => primary),
        } as unknown as Repository;
        const config = {
            get: jest.fn((key: keyof typeof configValues) => configValues[key]),
        } as unknown as ConfigService<EnvConfig, true>;
        const eventBus = {
            publish: jest.fn(),
        } as unknown as EventBus;

        return {
            service: new MemberService(repository, config, eventBus),
            eventBus,
        };
    }

    it('회원 생성 후 가입 이벤트와 CUSTOMER 응답을 반환한다', async () => {
        const create = jest.fn().mockResolvedValue({ id: 1n });
        const { service, eventBus } = createService(create);

        const result = await service.signup(command);

        expect(create).toHaveBeenCalledWith({
            data: {
                name: command.name,
                email: command.email,
                hashedPassword: MemberDomain.generateHashedPassword(command.password, configValues.SECRET),
                phone: command.phone,
                role: MemberRole.CUSTOMER,
            },
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

    it('Prisma P2002를 EXISTING_MEMBER ConflictException으로 변환한다', async () => {
        const duplicateEmailError = new Prisma.PrismaClientKnownRequestError('duplicate email', {
            code: 'P2002',
            clientVersion: '7.9.1',
            meta: { target: ['email'] },
        });
        const create = jest.fn().mockRejectedValue(duplicateEmailError);
        const { service, eventBus } = createService(create);

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
});
