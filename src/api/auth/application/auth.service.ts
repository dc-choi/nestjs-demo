import type { EntityRepository } from '@mikro-orm/core';
import { InjectRepository } from '@mikro-orm/nestjs';
import { Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { MemberDomain } from '~/api/member/domain/member.domain';
import { MemberEntity } from '~/api/member/domain/member.entity';
import { PasswordKdfSaturatedError } from '~/api/member/domain/password-kdf.admission';
import { InvalidIdOrPassword, PasswordKdfBusy } from '~/global/common/error/auth.error';
import { NotExistingMember } from '~/global/common/error/member.error';
import { EnvConfig } from '~/global/config/env/env.config';
import { TokenProvider } from '~/global/jwt/token.provider';

@Injectable()
export class AuthService {
    constructor(
        @InjectRepository(MemberEntity)
        private readonly repository: EntityRepository<MemberEntity>,
        private readonly config: ConfigService<EnvConfig, true>,
        private readonly tokenProvider: TokenProvider
    ) {}

    async login({ email, password }: LoginCommand) {
        const findMember = await this.repository.findOne(
            { email, deletedAt: null },
            {
                fields: ['id', 'role', 'hashedPassword'],
                connectionType: 'write',
                disableIdentityMap: true,
            }
        );
        const passwordVerification = await this.runPasswordKdf(() =>
            MemberDomain.verifyPassword(password, findMember?.hashedPassword ?? null, this.config.get<string>('SECRET'))
        );
        if (!findMember || !passwordVerification.isValid) throw new UnauthorizedException(new InvalidIdOrPassword());

        const { id, role } = findMember;
        if (passwordVerification.needsRehash) {
            const hashedPassword = await this.runPasswordKdf(() => MemberDomain.hashPassword(password));
            await this.repository.nativeUpdate(
                { id, hashedPassword: findMember.hashedPassword, deletedAt: null },
                { hashedPassword }
            );
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
}

interface RefreshTokenCommand {
    accessToken: string;
    refreshToken: string;
}
