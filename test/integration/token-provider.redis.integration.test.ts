import type { JwtService } from '@nestjs/jwt';

import Redis from 'ioredis';
import { createHash, randomUUIDv7 } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MemberRole } from '~/api/member/domain/member-role';
import { TokenProvider } from '~/global/jwt/token.provider';

const enabled = process.env.REDIS_INTEGRATION === '1';
const describeRedis = enabled ? describe : describe.skip;

describeRedis('TokenProvider Redis integration', () => {
    const memberId = BigInt(`9${Date.now()}`);
    const currentKey = `token:${memberId}`;
    const jwtService = { sign: () => 'access-token' } as unknown as JwtService;
    let redis: Redis | undefined;
    let provider: TokenProvider;
    const knownTokenHashes = new Set<string>();
    const knownFamilies = new Set<string>();

    beforeAll(async () => {
        const client = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379', {
            connectTimeout: 2_000,
            maxRetriesPerRequest: 0,
            retryStrategy: () => null,
        });
        await client.ping();
        redis = client;
        provider = new TokenProvider(jwtService, client);
    });

    afterAll(async () => {
        if (!redis) return;
        const keys = [currentKey];
        for (const tokenHash of knownTokenHashes) keys.push(`token:used:${tokenHash}`);
        for (const family of knownFamilies) keys.push(`token:family:${family}`);
        await redis.del(...keys);
        await redis.quit();
    });

    it('stores only hashes, atomically rotates once, and revokes the family on recognized replay', async () => {
        const activeRedis = getRedis();
        const issued = await provider.generateToken(memberId, MemberRole.CUSTOMER);
        remember(issued.refreshToken);
        const issuedCurrent = await activeRedis.get(currentKey);
        const issuedFamily = rememberFamily(issuedCurrent);

        expect(issuedCurrent).toMatch(/^v1:[^:]+:[^:]+$/);
        expect(issuedCurrent).not.toContain(issued.refreshToken);

        const rotations = await Promise.allSettled([
            provider.rotateToken(memberId, MemberRole.CUSTOMER, issued.refreshToken),
            provider.rotateToken(memberId, MemberRole.CUSTOMER, issued.refreshToken),
        ]);
        const successfulRotation = rotations.find((result) => result.status === 'fulfilled');
        if (!successfulRotation || successfulRotation.status !== 'fulfilled') {
            throw new Error('One concurrent refresh-token rotation must succeed');
        }
        expect(rotations.filter((result) => result.status === 'rejected')).toHaveLength(1);
        remember(successfulRotation.value.refreshToken);
        expect(await activeRedis.get(`token:used:${hash(issued.refreshToken)}`)).toBe(issuedFamily);
        expect(await activeRedis.get(currentKey)).toBeNull();
    });

    it('rejects an unknown RT without revoking the current session', async () => {
        const activeRedis = getRedis();
        const issued = await provider.generateToken(memberId, MemberRole.CUSTOMER);
        remember(issued.refreshToken);
        const current = await activeRedis.get(currentKey);
        rememberFamily(current);
        const unknown = randomUUIDv7();

        await expect(provider.rotateToken(memberId, MemberRole.CUSTOMER, unknown)).rejects.toMatchObject({
            response: { type: 'INVALID_REFRESH_TOKEN' },
        });
        expect(await activeRedis.get(currentKey)).toBe(current);
    });

    it('safely migrates a legacy raw Redis RT when it is first used', async () => {
        const activeRedis = getRedis();
        const legacyToken = randomUUIDv7();
        remember(legacyToken);
        await activeRedis.set(currentKey, legacyToken, 'EX', 60);

        const rotated = await provider.rotateToken(memberId, MemberRole.CUSTOMER, legacyToken);
        remember(rotated.refreshToken);
        const current = await activeRedis.get(currentKey);
        const family = rememberFamily(current);

        expect(current).not.toContain(legacyToken);
        expect(await activeRedis.get(`token:used:${hash(legacyToken)}`)).toBe(family);
    });

    function remember(token: string): void {
        knownTokenHashes.add(hash(token));
    }

    function rememberFamily(current: string | null): string {
        const family = current?.split(':')[1];
        if (!family) throw new Error('Expected a stored refresh token family');
        knownFamilies.add(family);
        return family;
    }

    function getRedis(): Redis {
        if (!redis) throw new Error('Redis integration client is unavailable');
        return redis;
    }
});

function hash(token: string): string {
    return createHash('sha256').update(token).digest('base64url');
}
