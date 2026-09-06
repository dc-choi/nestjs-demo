import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService, TokenExpiredError } from '@nestjs/jwt';

import { JwtClaims } from './payload/jwt.payload';

import Redis from 'ioredis';
import { createHash, randomUUIDv7 } from 'node:crypto';
import type { MemberRole } from '~/api/member/domain/member-role';
import { InvalidRefreshToken, NotExpiredAccessToken } from '~/global/common/error/auth.error';
import { WEEK } from '~/global/common/utils/time';
import { REDIS_CLIENT } from '~/infra/redis/redis-client.module';

const REFRESH_TOKEN_TTL_SECONDS = WEEK * 2;
const REFRESH_TOKEN_PREFIX = 'token:';
const REFRESH_TOKEN_USED_PREFIX = 'token:used:';
const REFRESH_TOKEN_FAMILY_PREFIX = 'token:family:';

const ISSUE_SESSION_SCRIPT = `
local current = redis.call('GET', KEYS[1])
if current then
  local family, oldHash = string.match(current, '^v1:([^:]+):([^:]+)$')
  if family and oldHash then
    redis.call('SET', ARGV[4] .. oldHash, family, 'EX', ARGV[1])
  end
end
redis.call('SET', ARGV[5] .. ARGV[2], ARGV[6], 'EX', ARGV[1])
redis.call('SET', KEYS[1], 'v1:' .. ARGV[2] .. ':' .. ARGV[3], 'EX', ARGV[1])
return 'issued'
`;

const ROTATE_SESSION_SCRIPT = `
local current = redis.call('GET', KEYS[1])
local usedFamily = redis.call('GET', KEYS[2])

if current then
  local family, currentHash = string.match(current, '^v1:([^:]+):([^:]+)$')
  if family and currentHash and currentHash == ARGV[2] then
    redis.call('SET', KEYS[2], family, 'EX', ARGV[1])
    redis.call('SET', ARGV[6] .. family, ARGV[7], 'EX', ARGV[1])
    redis.call('SET', KEYS[1], 'v1:' .. family .. ':' .. ARGV[3], 'EX', ARGV[1])
    return 'rotated'
  end

  if current == ARGV[4] then
    redis.call('SET', KEYS[2], ARGV[5], 'EX', ARGV[1])
    redis.call('SET', ARGV[6] .. ARGV[5], ARGV[7], 'EX', ARGV[1])
    redis.call('SET', KEYS[1], 'v1:' .. ARGV[5] .. ':' .. ARGV[3], 'EX', ARGV[1])
    return 'rotated'
  end

  if usedFamily then
    local currentFamily = string.match(current, '^v1:([^:]+):')
    if currentFamily == usedFamily then redis.call('DEL', KEYS[1]) end
    redis.call('DEL', ARGV[6] .. usedFamily)
    return 'replayed'
  end
  return 'invalid'
end

if usedFamily then
  redis.call('DEL', ARGV[6] .. usedFamily)
  return 'replayed'
end
return 'invalid'
`;

@Injectable()
export class TokenProvider {
    constructor(
        private readonly jwtService: JwtService,
        @Inject(REDIS_CLIENT) private readonly redis: Redis
    ) {}

    public async generateToken(memberId: bigint, role: MemberRole) {
        const accessToken = await this.generateAccessToken(memberId, role);
        const refreshToken = randomUUIDv7();
        await this.issueSession(memberId, refreshToken);

        return { accessToken, refreshToken };
    }

    public async rotateToken(memberId: bigint, role: MemberRole, refreshToken: string) {
        const accessToken = await this.generateAccessToken(memberId, role);
        const nextRefreshToken = randomUUIDv7();
        const result = await this.redis.eval(
            ROTATE_SESSION_SCRIPT,
            2,
            refreshTokenKey(memberId),
            usedTokenKey(hashRefreshToken(refreshToken)),
            String(REFRESH_TOKEN_TTL_SECONDS),
            hashRefreshToken(refreshToken),
            hashRefreshToken(nextRefreshToken),
            refreshToken,
            randomUUIDv7(),
            REFRESH_TOKEN_FAMILY_PREFIX,
            memberId.toString()
        );

        if (result !== 'rotated') throw new UnauthorizedException(new InvalidRefreshToken());

        return { accessToken, refreshToken: nextRefreshToken };
    }

    public async verifyExpiredAccessToken(accessToken: string): Promise<bigint> {
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

    private async issueSession(memberId: bigint, refreshToken: string): Promise<void> {
        await this.redis.eval(
            ISSUE_SESSION_SCRIPT,
            1,
            refreshTokenKey(memberId),
            String(REFRESH_TOKEN_TTL_SECONDS),
            randomUUIDv7(),
            hashRefreshToken(refreshToken),
            REFRESH_TOKEN_USED_PREFIX,
            REFRESH_TOKEN_FAMILY_PREFIX,
            memberId.toString()
        );
    }

    private async generateAccessToken(memberId: bigint, role: MemberRole): Promise<string> {
        const claims: JwtClaims = { memberId: memberId.toString(), role };
        return this.jwtService.sign(claims);
    }
}

function refreshTokenKey(memberId: bigint): string {
    return `${REFRESH_TOKEN_PREFIX}${memberId}`;
}

function usedTokenKey(tokenHash: string): string {
    return `${REFRESH_TOKEN_USED_PREFIX}${tokenHash}`;
}

function hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('base64url');
}
