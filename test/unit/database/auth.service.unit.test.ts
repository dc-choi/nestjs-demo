import type { EntityRepository } from '@mikro-orm/core';
import { ConfigService } from '@nestjs/config';

import { describe, expect, it, vi } from 'vitest';
import { AuthService } from '~/api/auth/application/auth.service';
import { MemberRole } from '~/api/member/domain/member-role';
import { MemberDomain } from '~/api/member/domain/member.domain';
import { MemberEntity } from '~/api/member/domain/member.entity';
import { EnvConfig } from '~/global/config/env/env.config';
import { TokenProvider } from '~/global/jwt/token.provider';

describe('AuthService', () => {
    it('lastLoginAt을 조건부 갱신한 한 요청만 최초 로그인으로 반환한다', async () => {
        const member = {
            id: 1n,
            role: MemberRole.CUSTOMER,
        };
        const findOne = vi.fn<() => Promise<typeof member>>().mockResolvedValue(member);
        const nativeUpdate = vi
            .fn<() => Promise<number>>()
            .mockResolvedValueOnce(1)
            .mockResolvedValueOnce(0)
            .mockResolvedValueOnce(1);
        const repository = {
            findOne,
            nativeUpdate,
        } as unknown as EntityRepository<MemberEntity>;
        const config = {
            get: vi.fn().mockReturnValue('test-secret'),
        } as unknown as ConfigService<EnvConfig, true>;
        const tokenProvider = {
            generateToken: vi.fn<() => Promise<{ accessToken: string; refreshToken: string }>>().mockResolvedValue({
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
        expect(findOne).toHaveBeenCalledWith(
            {
                email: command.email,
                hashedPassword: MemberDomain.generateHashedPassword(command.password, 'test-secret'),
                deletedAt: null,
            },
            expect.objectContaining({ connectionType: 'write', disableIdentityMap: true })
        );
        expect(nativeUpdate).toHaveBeenNthCalledWith(
            1,
            { id: member.id, lastLoginAt: null, deletedAt: null },
            { lastLoginAt: expect.any(Date), updatedAt: expect.any(Date) }
        );
        expect(nativeUpdate).toHaveBeenNthCalledWith(
            2,
            { id: member.id, lastLoginAt: null, deletedAt: null },
            { lastLoginAt: expect.any(Date), updatedAt: expect.any(Date) }
        );
        expect(nativeUpdate).toHaveBeenNthCalledWith(
            3,
            { id: member.id },
            { lastLoginAt: expect.any(Date), updatedAt: expect.any(Date) }
        );
    });

    it('refresh token 검증 뒤 writer에서 회원을 확인하고 bigint id를 그대로 사용한다', async () => {
        const memberId = 9007199254740993n;
        const member = { id: memberId, role: MemberRole.SELLER };
        const repository = {
            findOne: vi.fn<() => Promise<typeof member>>().mockResolvedValue(member),
        } as unknown as EntityRepository<MemberEntity>;
        const config = {
            get: vi.fn().mockReturnValue('test-secret'),
        } as unknown as ConfigService<EnvConfig, true>;
        const tokenProvider = {
            verifyToken: vi.fn<() => Promise<{ memberId: bigint }>>().mockResolvedValue({ memberId }),
            generateToken: vi.fn<() => Promise<{ accessToken: string; refreshToken: string }>>().mockResolvedValue({
                accessToken: 'new-access-token',
                refreshToken: 'new-refresh-token',
            }),
        } as unknown as TokenProvider;
        const service = new AuthService(repository, config, tokenProvider);

        await expect(
            service.token({ accessToken: 'expired-access-token', refreshToken: 'refresh-token' })
        ).resolves.toEqual({
            accessToken: 'new-access-token',
            refreshToken: 'new-refresh-token',
        });
        expect(repository.findOne).toHaveBeenCalledWith(
            { id: memberId, deletedAt: null },
            expect.objectContaining({ connectionType: 'write', disableIdentityMap: true })
        );
        expect(tokenProvider.generateToken).toHaveBeenCalledWith(memberId, MemberRole.SELLER);
    });
});
