import { InjectRedis } from '@nestjs-modules/ioredis';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService, TokenExpiredError } from '@nestjs/jwt';

import { JwtClaims } from './payload/jwt.payload';

import Redis from 'ioredis';
import { randomUUIDv7 } from 'node:crypto';
import type { MemberRole } from '~/api/member/domain/member-role';
import { InvalidRefreshToken, NotExpiredAccessToken } from '~/global/common/error/auth.error';
import { WEEK } from '~/global/common/utils/time';

@Injectable()
export class TokenProvider {
    constructor(
        private readonly jwtService: JwtService,
        @InjectRedis() private readonly redis: Redis
    ) {}

    /**
     * accessToken, refreshToken 발급
     */
    public async generateToken(memberId: bigint, role: MemberRole) {
        const [accessToken, refreshToken] = await Promise.all([
            this.generateAccessToken(memberId, role),
            this.generateRefreshToken(memberId),
        ]);

        return {
            accessToken,
            refreshToken,
        };
    }

    /**
     * accessToken, refreshToken 검증
     */
    public async verifyToken(accessToken: string, refreshToken: string) {
        const memberId = await this.verifyExpiredAccessToken(accessToken);
        const redisToken = await this.verifyRefreshToken(memberId, refreshToken);

        return { memberId, redisToken };
    }

    /**
     * accessToken 발급
     */
    private async generateAccessToken(memberId: bigint, role: MemberRole) {
        const claims: JwtClaims = {
            memberId: memberId.toString(),
            role,
        };

        return this.jwtService.sign(claims);
    }

    /**
     * RTR방식으로 refreshToken 발급
     */
    private async generateRefreshToken(memberId: bigint) {
        let refreshToken = await this.redis.get(`token:${memberId}`);
        if (refreshToken) await this.redis.del(`token:${memberId}`);

        refreshToken = randomUUIDv7();

        // INFO: refreshToken의 유효기간은 2주로 설정
        await this.redis.set(`token:${memberId}`, refreshToken, 'EX', WEEK * 2);

        return refreshToken;
    }

    /**
     * accessToken 검증
     */
    private async verifyExpiredAccessToken(accessToken: string) {
        try {
            await this.jwtService.verifyAsync(accessToken);
        } catch (error: unknown) {
            if (!(error instanceof TokenExpiredError)) {
                throw new UnauthorizedException(new InvalidRefreshToken());
            }

            const claims = await this.jwtService
                .verifyAsync<JwtClaims>(accessToken, { ignoreExpiration: true })
                .catch(() => {
                    throw new UnauthorizedException(new InvalidRefreshToken());
                });

            if (typeof claims.memberId !== 'string' || !/^\d+$/.test(claims.memberId)) {
                throw new UnauthorizedException(new InvalidRefreshToken());
            }

            return BigInt(claims.memberId);
        }

        throw new UnauthorizedException(new NotExpiredAccessToken());
    }

    /**
     * refreshToken 검증
     */
    private async verifyRefreshToken(memberId: bigint, refreshToken: string) {
        const redisToken = await this.redis.get(`token:${memberId}`);

        if (redisToken !== refreshToken) throw new UnauthorizedException(new InvalidRefreshToken());

        return redisToken;
    }
}
