import type { EntityRepository } from '@mikro-orm/core';
import { HttpException, HttpStatus, ServiceUnavailableException } from '@nestjs/common';

import { describe, expect, it, vi } from 'vitest';
import { AuthService } from '~/api/auth/application/auth.service.js';
import { LoginRateLimited } from '~/api/auth/application/login-rate-limited.error.js';
import { LoginRateLimiter } from '~/api/auth/infrastructure/login-rate-limiter.js';
import { TokenProvider } from '~/api/auth/infrastructure/token.provider.js';
import { MemberService } from '~/api/member/application/member.service.js';
import { PasswordKdfSaturatedError } from '~/api/member/application/password-kdf-saturated.error.js';
import { PasswordService } from '~/api/member/application/password.service.js';
import { MemberRole } from '~/api/member/domain/entity/member-role.js';
import { MemberEntity } from '~/api/member/domain/entity/member.entity.js';

const command = { email: 'member@example.com', password: 'password', clientIp: '198.51.100.20' };

function createService({
    repository = {} as EntityRepository<MemberEntity>,
    passwordService = {} as PasswordService,
    memberService = {} as MemberService,
    tokenProvider = {} as TokenProvider,
    loginRateLimiter = { assertAllowed: vi.fn().mockResolvedValue(undefined) } as unknown as LoginRateLimiter,
}: {
    repository?: EntityRepository<MemberEntity>;
    passwordService?: PasswordService;
    memberService?: MemberService;
    tokenProvider?: TokenProvider;
    loginRateLimiter?: LoginRateLimiter;
}) {
    return new AuthService(repository, passwordService, memberService, tokenProvider, loginRateLimiter);
}

function issuingTokenProvider(): TokenProvider {
    return {
        generateToken: vi.fn<() => Promise<{ accessToken: string; refreshToken: string }>>().mockResolvedValue({
            accessToken: 'access-token',
            refreshToken: 'refresh-token',
        }),
    } as unknown as TokenProvider;
}

describe('AuthService', () => {
    it('계정 조회와 비밀번호 KDF 전에 요청 제한을 먼저 검사한다', async () => {
        const repository = { findOne: vi.fn() } as unknown as EntityRepository<MemberEntity>;
        const passwordService = { verify: vi.fn() } as unknown as PasswordService;
        const loginRateLimiter = {
            assertAllowed: vi
                .fn()
                .mockRejectedValue(new HttpException(new LoginRateLimited(), HttpStatus.TOO_MANY_REQUESTS)),
        } as unknown as LoginRateLimiter;
        const service = createService({ repository, passwordService, loginRateLimiter });

        await expect(service.login(command)).rejects.toBeInstanceOf(HttpException);

        expect(loginRateLimiter.assertAllowed).toHaveBeenCalledWith(command.email, command.clientIp);
        expect(repository.findOne).not.toHaveBeenCalled();
        expect(passwordService.verify).not.toHaveBeenCalled();
    });

    it('KDF 동시 처리 한도 초과를 ServiceUnavailable으로 반환한다', async () => {
        const repository = { findOne: vi.fn(async () => null) } as unknown as EntityRepository<MemberEntity>;
        const passwordService = {
            verify: vi.fn().mockRejectedValue(new PasswordKdfSaturatedError()),
        } as unknown as PasswordService;
        const service = createService({ repository, passwordService });

        await expect(service.login(command)).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it('존재하지 않는 계정도 비밀번호 검증 비용을 지불한 뒤 같은 인증 오류를 반환한다', async () => {
        const repository = { findOne: vi.fn(async () => null) } as unknown as EntityRepository<MemberEntity>;
        const verify = vi.fn().mockResolvedValue({ isValid: false, needsRehash: false });
        const service = createService({ repository, passwordService: { verify } as unknown as PasswordService });

        await expect(service.login({ ...command, email: 'missing@example.com', password: 'wrong' })).rejects.toThrow();
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
        const service = createService({ repository, passwordService, tokenProvider: issuingTokenProvider() });

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

    it('legacy hash 로그인 성공 시 검증한 hash를 기대값으로 member에 hash 갱신을 맡긴다', async () => {
        const member = { id: 1n, role: MemberRole.CUSTOMER, hashedPassword: 'legacy-hash' };
        const repository = {
            findOne: vi.fn<() => Promise<typeof member>>().mockResolvedValue(member),
            nativeUpdate: vi.fn<() => Promise<number>>().mockResolvedValue(1),
        } as unknown as EntityRepository<MemberEntity>;
        const passwordService = {
            verify: vi.fn().mockResolvedValue({ isValid: true, needsRehash: true }),
        } as unknown as PasswordService;
        const memberService = {
            upgradePasswordHash: vi.fn().mockResolvedValue(undefined),
        } as unknown as MemberService;
        const service = createService({
            repository,
            passwordService,
            memberService,
            tokenProvider: issuingTokenProvider(),
        });

        await service.login(command);

        expect(memberService.upgradePasswordHash).toHaveBeenCalledWith(member.id, 'legacy-hash', command.password);
        expect(repository.nativeUpdate).not.toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ hashedPassword: expect.anything() })
        );
    });

    it('hash 갱신의 KDF 포화도 ServiceUnavailable으로 반환한다', async () => {
        const member = { id: 1n, role: MemberRole.CUSTOMER, hashedPassword: 'legacy-hash' };
        const repository = {
            findOne: vi.fn<() => Promise<typeof member>>().mockResolvedValue(member),
        } as unknown as EntityRepository<MemberEntity>;
        const passwordService = {
            verify: vi.fn().mockResolvedValue({ isValid: true, needsRehash: true }),
        } as unknown as PasswordService;
        const memberService = {
            upgradePasswordHash: vi.fn().mockRejectedValue(new PasswordKdfSaturatedError()),
        } as unknown as MemberService;
        const service = createService({ repository, passwordService, memberService });

        await expect(service.login(command)).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it('expired access token verification 뒤 writer에서 회원을 확인하고 제출된 RT를 원자 회전한다', async () => {
        const memberId = 9007199254740993n;
        const member = { id: memberId, role: MemberRole.SELLER };
        const repository = {
            findOne: vi.fn<() => Promise<typeof member>>().mockResolvedValue(member),
        } as unknown as EntityRepository<MemberEntity>;
        const tokenProvider = {
            verifyExpiredAccessToken: vi.fn<() => Promise<bigint>>().mockResolvedValue(memberId),
            rotateToken: vi.fn<() => Promise<{ accessToken: string; refreshToken: string }>>().mockResolvedValue({
                accessToken: 'new-access-token',
                refreshToken: 'new-refresh-token',
            }),
        } as unknown as TokenProvider;
        const service = createService({ repository, tokenProvider });

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
