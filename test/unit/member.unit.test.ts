import { describe, expect, it } from 'vitest';
import { MemberDomain } from '~/api/member/domain/member.domain';
import { PasswordKdfSaturatedError } from '~/api/member/domain/password-kdf.admission';

describe('MemberDomain', () => {
    it('shares one KDF slot between password creation and login verification', async () => {
        const hashing = MemberDomain.hashPassword('password');
        await expect(MemberDomain.verifyPassword('password', null, 'legacy-secret')).rejects.toBeInstanceOf(
            PasswordKdfSaturatedError
        );
        const storedHash = await hashing;
        await expect(MemberDomain.verifyPassword('password', storedHash, 'legacy-secret')).resolves.toEqual({
            isValid: true,
            needsRehash: false,
        });
    });

    it('stores a versioned scrypt hash with a unique salt and verifies it', async () => {
        const firstHash = await MemberDomain.hashPassword('password');
        const secondHash = await MemberDomain.hashPassword('password');

        expect(firstHash).toMatch(/^scrypt-v1\$131072\$8\$1\$/);
        expect(firstHash).not.toBe(secondHash);
        await expect(MemberDomain.verifyPassword('password', firstHash, 'legacy-secret')).resolves.toEqual({
            isValid: true,
            needsRehash: false,
        });
        await expect(MemberDomain.verifyPassword('wrong-password', firstHash, 'legacy-secret')).resolves.toEqual({
            isValid: false,
            needsRehash: false,
        });
    }, 30_000);

    it('accepts a valid legacy HMAC only so the caller can upgrade it', async () => {
        const legacyHash = MemberDomain.generateLegacyHashedPassword('password', 'legacy-secret');

        await expect(MemberDomain.verifyPassword('password', legacyHash, 'legacy-secret')).resolves.toEqual({
            isValid: true,
            needsRehash: true,
        });
        await expect(MemberDomain.verifyPassword('wrong-password', legacyHash, 'legacy-secret')).resolves.toEqual({
            isValid: false,
            needsRehash: false,
        });
    });
});
