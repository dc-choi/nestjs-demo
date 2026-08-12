import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { REPOSITORY, Repository } from 'prisma/repository';
import { MemberDomain } from '~/api/member/domain/member.domain';
import { InvalidIdOrPassword } from '~/global/common/error/auth.error';
import { NotExistingMember } from '~/global/common/error/member.error';
import { EnvConfig } from '~/global/config/env/env.config';
import { TokenProvider } from '~/global/jwt/token.provider';

@Injectable()
export class AuthService {
    constructor(
        @Inject(REPOSITORY) private readonly repository: Repository,
        private readonly config: ConfigService<EnvConfig, true>,
        private readonly tokenProvider: TokenProvider
    ) {}

    async login({ email, password }: LoginCommand) {
        const salt = this.config.get<string>('SECRET');
        const primary = this.repository.$primary();

        const findMember = await primary.member.findFirst({
            where: {
                email,
                hashedPassword: MemberDomain.generateHashedPassword(password, salt),
                deletedAt: null,
            },
        });
        if (!findMember) throw new UnauthorizedException(new InvalidIdOrPassword());

        const { id, role } = findMember;
        // 조건부 갱신을 사용해 동시 로그인 중 정확히 한 요청만 최초 로그인으로 판정한다.
        const loggedInAt = new Date();
        const { count } = await primary.member.updateMany({
            where: {
                id,
                lastLoginAt: null,
                deletedAt: null,
            },
            data: {
                lastLoginAt: loggedInAt,
            },
        });
        const isFirstLogin = count === 1;
        if (!isFirstLogin) {
            await primary.member.update({
                where: { id },
                data: { lastLoginAt: loggedInAt },
            });
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
        const findMember = await this.repository.$primary().member.findFirst({
            where: {
                id: memberId,
                deletedAt: null,
            },
        });
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
