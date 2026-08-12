import { ConfigService } from '@nestjs/config';

import { MemberRole } from 'prisma/generated/client/enums';
import { Repository } from 'prisma/repository';
import { AuthService } from '~/api/auth/application/auth.service';
import { MemberDomain } from '~/api/member/domain/member.domain';
import { EnvConfig } from '~/global/config/env/env.config';
import { TokenProvider } from '~/global/jwt/token.provider';

describe('AuthService', () => {
    it('lastLoginAt을 조건부 갱신한 한 요청만 최초 로그인으로 반환한다', async () => {
        const member = {
            id: 1n,
            role: MemberRole.CUSTOMER,
        };
        const findFirst = jest.fn().mockResolvedValue(member);
        const updateMany = jest.fn().mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
        const update = jest.fn().mockResolvedValue(member);
        const primary = { member: { findFirst, updateMany, update } };
        const repository = {
            $primary: jest.fn(() => primary),
        } as unknown as Repository;
        const config = {
            get: jest.fn().mockReturnValue('test-secret'),
        } as unknown as ConfigService<EnvConfig, true>;
        const tokenProvider = {
            generateToken: jest.fn().mockResolvedValue({
                accessToken: 'access-token',
                refreshToken: 'refresh-token',
            }),
        } as unknown as TokenProvider;
        const service = new AuthService(repository, config, tokenProvider);
        const command = { email: 'member@example.com', password: 'password' };

        const firstLogin = await service.login(command);
        const nextLogin = await service.login(command);

        expect(firstLogin.isFirstLogin).toBe(true);
        expect(nextLogin.isFirstLogin).toBe(false);
        expect(findFirst).toHaveBeenCalledWith({
            where: {
                email: command.email,
                hashedPassword: MemberDomain.generateHashedPassword(command.password, 'test-secret'),
                deletedAt: null,
            },
        });
        expect(updateMany).toHaveBeenCalledTimes(2);
        expect(updateMany).toHaveBeenCalledWith({
            where: {
                id: member.id,
                lastLoginAt: null,
                deletedAt: null,
            },
            data: {
                lastLoginAt: expect.any(Date),
            },
        });
        expect(update).toHaveBeenCalledTimes(1);
        expect(update).toHaveBeenCalledWith({
            where: { id: member.id },
            data: { lastLoginAt: expect.any(Date) },
        });
    });
});
