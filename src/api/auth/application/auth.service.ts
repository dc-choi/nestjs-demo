import type { EntityRepository } from '@mikro-orm/core';
import { InjectRepository } from '@mikro-orm/nestjs';
import { Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';

import { InvalidIdOrPassword } from '~/api/auth/application/invalid-id-or-password.error.js';
import { NotExistingMember } from '~/api/auth/application/not-existing-member.error.js';
import { LoginRateLimiter } from '~/api/auth/infrastructure/login-rate-limiter.js';
import { TokenProvider } from '~/api/auth/infrastructure/token.provider.js';
import { MemberService } from '~/api/member/application/member.service.js';
import { PasswordKdfBusy } from '~/api/member/application/password-kdf-busy.error.js';
import { PasswordKdfSaturatedError } from '~/api/member/application/password-kdf-saturated.error.js';
import { PasswordService } from '~/api/member/application/password.service.js';
import { MemberEntity } from '~/api/member/domain/entity/member.entity.js';

@Injectable()
export class AuthService {
    constructor(
        @InjectRepository(MemberEntity)
        private readonly repository: EntityRepository<MemberEntity>,
        private readonly passwordService: PasswordService,
        private readonly memberService: MemberService,
        private readonly tokenProvider: TokenProvider,
        private readonly loginRateLimiter: LoginRateLimiter
    ) {}

    async login({ email, password, clientIp }: LoginCommand) {
        // 계정 조회와 KDF 비용을 쓰기 전에 계정별, 클라이언트별 시도 횟수를 먼저 센다.
        await this.loginRateLimiter.assertAllowed(email, clientIp);

        const findMember = await this.repository.findOne(
            { email, deletedAt: null },
            {
                fields: ['id', 'role', 'hashedPassword'],
                connectionType: 'write',
                disableIdentityMap: true,
            }
        );
        const passwordVerification = await this.runPasswordKdf(() =>
            this.passwordService.verify(password, findMember?.hashedPassword ?? null)
        );
        if (!findMember || !passwordVerification.isValid) throw new UnauthorizedException(new InvalidIdOrPassword());

        const { id, role, hashedPassword } = findMember;
        if (passwordVerification.needsRehash && hashedPassword) {
            await this.runPasswordKdf(() => this.memberService.upgradePasswordHash(id, hashedPassword, password));
        }

        const loggedInAt = new Date();
        // 조건부 UPDATE의 affected row 수로 동시 로그인 중 한 요청만 최초 로그인으로 판정한다.
        const updated = await this.repository.nativeUpdate(
            { id, lastLoginAt: null, deletedAt: null },
            { lastLoginAt: loggedInAt, updatedAt: loggedInAt }
        );
        const isFirstLogin = updated === 1;
        if (!isFirstLogin) {
            await this.repository.nativeUpdate({ id }, { lastLoginAt: loggedInAt, updatedAt: loggedInAt });
        }

        const { accessToken, refreshToken } = await this.tokenProvider.generateToken(id, role);

        return {
            accessToken,
            refreshToken,
            role,
            isFirstLogin,
        };
    }

    async token({ accessToken, refreshToken }: RefreshTokenCommand) {
        const memberId = await this.tokenProvider.verifyExpiredAccessToken(accessToken);
        const findMember = await this.repository.findOne(
            { id: memberId, deletedAt: null },
            {
                fields: ['id', 'role'],
                connectionType: 'write',
                disableIdentityMap: true,
            }
        );
        if (!findMember) throw new UnauthorizedException(new NotExistingMember());

        const { accessToken: newAccessToken, refreshToken: newRefreshToken } = await this.tokenProvider.rotateToken(
            memberId,
            findMember.role,
            refreshToken
        );

        return {
            accessToken: newAccessToken,
            refreshToken: newRefreshToken,
        };
    }

    private async runPasswordKdf<T>(operation: () => Promise<T>): Promise<T> {
        try {
            return await operation();
        } catch (error: unknown) {
            if (error instanceof PasswordKdfSaturatedError) {
                throw new ServiceUnavailableException(new PasswordKdfBusy());
            }

            throw error;
        }
    }
}

interface LoginCommand {
    email: string;
    password: string;
    clientIp: string;
}

interface RefreshTokenCommand {
    accessToken: string;
    refreshToken: string;
}
