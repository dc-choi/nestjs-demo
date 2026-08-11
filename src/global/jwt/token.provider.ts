import { InjectRedis } from '@nestjs-modules/ioredis';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import { JwtPayload } from './payload/jwt.payload';

import Redis from 'ioredis';
import { randomUUIDv7 } from 'node:crypto';
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
    public async generateToken(memberId: bigint, role: string) {
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
        const { memberId, role } = await this.verifyAccessToken(accessToken);
        const redisToken = await this.verifyRefreshToken(memberId, refreshToken);

        return { memberId, role, redisToken };
    }

    /**
     * accessToken 발급
     */
    private async generateAccessToken(memberId: bigint, role: string) {
        return this.jwtService.sign({
            memberId,
            role,
        });
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
    private async verifyAccessToken(accessToken: string) {
        let memberId: bigint = BigInt(0);
        let role: string = '';
        let isNotExpired = true;

        await this.jwtService.verifyAsync<JwtPayload>(accessToken).catch(() => {
            const { memberId: parsedMemberId, role: parsedRole } = this.jwtService.decode<JwtPayload>(accessToken);
            memberId = parsedMemberId;
            role = parsedRole;
            isNotExpired = false;
        });

        if (isNotExpired) throw new UnauthorizedException(new NotExpiredAccessToken());

        return { memberId, role };
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
