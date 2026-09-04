import type { EntityRepository } from '@mikro-orm/core';
import { InjectRepository } from '@mikro-orm/nestjs';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { MemberDomain } from '~/api/member/domain/member.domain';
import { MemberEntity } from '~/api/member/domain/member.entity';
import { InvalidIdOrPassword } from '~/global/common/error/auth.error';
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
        const salt = this.config.get<string>('SECRET');
        const hashedPassword = MemberDomain.generateHashedPassword(password, salt);
        const findMember = await this.repository.findOne(
            { email, hashedPassword, deletedAt: null },
            {
                fields: ['id', 'role'],
                connectionType: 'write',
                disableIdentityMap: true,
            }
        );
        if (!findMember) throw new UnauthorizedException(new InvalidIdOrPassword());

        const { id, role } = findMember;
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
        const { memberId } = await this.tokenProvider.verifyToken(accessToken, refreshToken);
        const findMember = await this.repository.findOne(
            { id: memberId, deletedAt: null },
            {
                fields: ['id', 'role'],
                connectionType: 'write',
                disableIdentityMap: true,
            }
        );
        if (!findMember) throw new UnauthorizedException(new NotExistingMember());

        const { accessToken: newAccessToken, refreshToken: newRefreshToken } = await this.tokenProvider.generateToken(
            memberId,
            findMember.role
        );

        return {
            accessToken: newAccessToken,
            refreshToken: newRefreshToken,
        };
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
