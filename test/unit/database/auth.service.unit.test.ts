import type { EntityRepository } from '@mikro-orm/core';
import { ServiceUnavailableException } from '@nestjs/common';

import { describe, expect, it, vi } from 'vitest';
import { AuthService } from '~/api/auth/application/auth.service';
import { PasswordKdfSaturatedError } from '~/api/member/application/password-kdf.admission';
import { PasswordService } from '~/api/member/application/password.service';
import { MemberRole } from '~/api/member/domain/member-role';
import { MemberEntity } from '~/api/member/domain/member.entity';
import { TokenProvider } from '~/global/jwt/token.provider';

describe('AuthService', () => {
    it('KDF 동시 처리 한도 초과를 ServiceUnavailable으로 반환한다', async () => {
        const repository = { findOne: vi.fn(async () => null) } as unknown as EntityRepository<MemberEntity>;
        const passwordService = {
            verify: vi.fn().mockRejectedValue(new PasswordKdfSaturatedError()),
        } as unknown as PasswordService;
        const service = new AuthService(repository, passwordService, {} as TokenProvider);

        await expect(service.login({ email: 'member@example.com', password: 'password' })).rejects.toBeInstanceOf(
            ServiceUnavailableException
        );
    });

    it('존재하지 않는 계정도 비밀번호 검증 비용을 지불한 뒤 같은 인증 오류를 반환한다', async () => {
        const repository = { findOne: vi.fn(async () => null) } as unknown as EntityRepository<MemberEntity>;
        const verify = vi.fn().mockResolvedValue({ isValid: false, needsRehash: false });
        const passwordService = { verify } as unknown as PasswordService;
        const service = new AuthService(repository, passwordService, {} as TokenProvider);
        await expect(service.login({ email: 'missing@example.com', password: 'wrong' })).rejects.toThrow();
        expect(verify).toHaveBeenCalledWith('wrong', null);
    });
    it('lastLoginAt을 조건부 갱신한 한 요청만 최초 로그인으로 반환한다', async () => {
        const member = {
            id: 1n,
            role: MemberRole.CUSTOMER,
            hashedPassword: 'scrypt-v1$stored',
        };
        const findOne = vi.fn<() => Promise<typeof member>>().mockResolvedValue(member);
        const nativeUpdate = vi
            .fn<() => Promise<number>>()
            .mockResolvedValueOnce(1)
            .mockResolvedValueOnce(0)
            .mockResolvedValueOnce(1);
        const repository = { findOne, nativeUpdate } as unknown as EntityRepository<MemberEntity>;
        const passwordService = {
            verify: vi.fn().mockResolvedValue({ isValid: true, needsRehash: false }),
        } as unknown as PasswordService;
        const tokenProvider = {
            generateToken: vi.fn<() => Promise<{ accessToken: string; refreshToken: string }>>().mockResolvedValue({
                accessToken: 'access-token',
                refreshToken: 'refresh-token',
            }),
        } as unknown as TokenProvider;
        const service = new AuthService(repository, passwordService, tokenProvider);
        const command = { email: 'member@example.com', password: 'password' };

        const firstLogin = await service.login(command);
        const nextLogin = await service.login(command);

        expect(firstLogin.isFirstLogin).toBe(true);
        expect(nextLogin.isFirstLogin).toBe(false);
        expect(findOne).toHaveBeenCalledWith(
            { email: command.email, deletedAt: null },
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

    it('legacy password successful login upgrades only the row that still holds the verified hash', async () => {
        const member = { id: 1n, role: MemberRole.CUSTOMER, hashedPassword: 'legacy-hash' };
        const repository = {
            findOne: vi.fn<() => Promise<typeof member>>().mockResolvedValue(member),
            nativeUpdate: vi.fn<() => Promise<number>>().mockResolvedValue(1),
        } as unknown as EntityRepository<MemberEntity>;
        const passwordService = {
            verify: vi.fn().mockResolvedValue({ isValid: true, needsRehash: true }),
            hash: vi.fn().mockResolvedValue('scrypt-v1$new-hash'),
        } as unknown as PasswordService;
        const tokenProvider = {
            generateToken: vi.fn<() => Promise<{ accessToken: string; refreshToken: string }>>().mockResolvedValue({
                accessToken: 'access-token',
                refreshToken: 'refresh-token',
            }),
        } as unknown as TokenProvider;
        const service = new AuthService(repository, passwordService, tokenProvider);

        await service.login({ email: 'member@example.com', password: 'password' });

        expect(repository.nativeUpdate).toHaveBeenCalledWith(
            { id: member.id, hashedPassword: 'legacy-hash', deletedAt: null },
            { hashedPassword: 'scrypt-v1$new-hash' }
        );
    });

    it('expired access token verification 뒤 writer에서 회원을 확인하고 제출된 RT를 원자 회전한다', async () => {
        const memberId = 9007199254740993n;
        const member = { id: memberId, role: MemberRole.SELLER };
        const repository = {
            findOne: vi.fn<() => Promise<typeof member>>().mockResolvedValue(member),
        } as unknown as EntityRepository<MemberEntity>;
        const passwordService = {} as PasswordService;
        const tokenProvider = {
            verifyExpiredAccessToken: vi.fn<() => Promise<bigint>>().mockResolvedValue(memberId),
            rotateToken: vi.fn<() => Promise<{ accessToken: string; refreshToken: string }>>().mockResolvedValue({
                accessToken: 'new-access-token',
                refreshToken: 'new-refresh-token',
            }),
        } as unknown as TokenProvider;
        const service = new AuthService(repository, passwordService, tokenProvider);

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
        expect(tokenProvider.rotateToken).toHaveBeenCalledWith(memberId, MemberRole.SELLER, 'refresh-token');
    });
});
