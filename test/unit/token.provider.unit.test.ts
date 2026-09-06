import type { JwtService } from '@nestjs/jwt';

import { describe, expect, it, vi } from 'vitest';
import { MemberRole } from '~/api/member/domain/member-role';
import { TokenProvider } from '~/global/jwt/token.provider';

describe('TokenProvider', () => {
    it('signs access token before atomically creating a hashed refresh-token session', async () => {
        const sign = vi.fn().mockReturnValue('access-token');
        const evalScript = vi.fn().mockResolvedValue('issued');
        const provider = new TokenProvider({ sign } as unknown as JwtService, { eval: evalScript } as never);

        const tokens = await provider.generateToken(12n, MemberRole.CUSTOMER);

        expect(sign).toHaveBeenCalledBefore(evalScript);
        expect(evalScript).toHaveBeenCalledOnce();
        const args = evalScript.mock.calls[0];
        expect(args[0]).toContain("redis.call('SET', KEYS[1], 'v1:'");
        expect(args).toContain('token:12');
        expect(args).not.toContain(tokens.refreshToken);
    });

    it('returns a new pair only when the Redis compare-and-rotate script accepts the submitted token', async () => {
        const sign = vi.fn().mockReturnValue('access-token');
        const evalScript = vi.fn().mockResolvedValue('rotated');
        const provider = new TokenProvider({ sign } as unknown as JwtService, { eval: evalScript } as never);

        const tokens = await provider.rotateToken(12n, MemberRole.CUSTOMER, '018f0c20-2a00-7000-8000-000000000001');

        expect(tokens.accessToken).toBe('access-token');
        expect(tokens.refreshToken).not.toBe('018f0c20-2a00-7000-8000-000000000001');
        const args = evalScript.mock.calls[0];
        expect(args[0]).toContain("local usedFamily = redis.call('GET', KEYS[2])");
        expect(args).toContain('token:12');
        expect(args.some((argument) => typeof argument === 'string' && argument.startsWith('token:used:'))).toBe(true);
    });

    it('does not write a session if access-token signing fails', async () => {
        const evalScript = vi.fn();
        const provider = new TokenProvider(
            {
                sign: vi.fn().mockImplementation(() => Promise.reject(new Error('signing failed'))),
            } as unknown as JwtService,
            { eval: evalScript } as never
        );

        await expect(provider.generateToken(12n, MemberRole.CUSTOMER)).rejects.toThrow('signing failed');
        expect(evalScript).not.toHaveBeenCalled();
    });

    it('rejects a replay or unknown token without returning the pre-signed pair', async () => {
        const provider = new TokenProvider(
            { sign: vi.fn().mockReturnValue('access-token') } as unknown as JwtService,
            { eval: vi.fn().mockResolvedValue('replayed') } as never
        );

        await expect(
            provider.rotateToken(12n, MemberRole.CUSTOMER, '018f0c20-2a00-7000-8000-000000000001')
        ).rejects.toMatchObject({
            response: { type: 'INVALID_REFRESH_TOKEN' },
        });
    });
});
