import { ConfigService } from '@nestjs/config';

import { createHmac, randomBytes, scrypt } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { PasswordKdfAdmission, PasswordKdfSaturatedError } from '~/api/member/application/password-kdf.admission';
import { PasswordService } from '~/api/member/application/password.service';
import { EnvConfig } from '~/global/config/env/env.config';

describe('PasswordService', () => {
    it('shares one KDF slot between password creation and login verification', async () => {
        const admission = new PasswordKdfAdmission();
        const passwordService = createPasswordService(admission);
        const loginPasswordService = createPasswordService(admission);
        const hashing = passwordService.hash('password');
        await expect(loginPasswordService.verify('password', null)).rejects.toBeInstanceOf(PasswordKdfSaturatedError);
        const storedHash = await hashing;
        await expect(passwordService.verify('password', storedHash)).resolves.toEqual({
            isValid: true,
            needsRehash: false,
        });
    });

    it('stores a versioned scrypt hash with a unique salt and verifies it', async () => {
        const passwordService = createPasswordService();
        const firstHash = await passwordService.hash('password');
        const secondHash = await passwordService.hash('password');

        expect(firstHash).toMatch(/^scrypt-v1\$131072\$8\$1\$/);
        expect(firstHash).not.toBe(secondHash);
        await expect(passwordService.verify('password', firstHash)).resolves.toEqual({
            isValid: true,
            needsRehash: false,
        });
        await expect(passwordService.verify('wrong-password', firstHash)).resolves.toEqual({
            isValid: false,
            needsRehash: false,
        });
    }, 30_000);

    it('accepts a valid legacy HMAC only so the caller can upgrade it', async () => {
        const passwordService = createPasswordService();
        const legacyHash = createHmac('sha256', 'legacy-secret').update('password').digest('base64');

        await expect(passwordService.verify('password', legacyHash)).resolves.toEqual({
            isValid: true,
            needsRehash: true,
        });
        await expect(passwordService.verify('wrong-password', legacyHash)).resolves.toEqual({
            isValid: false,
            needsRehash: false,
        });
    });

    it('accepts the supported historical scrypt policy and requests a rehash', async () => {
        const passwordService = createPasswordService();
        const historicalHash = await hashWithHistoricalPolicy('password');

        await expect(passwordService.verify('password', historicalHash)).resolves.toEqual({
            isValid: true,
            needsRehash: true,
        });
        await expect(passwordService.verify('wrong-password', historicalHash)).resolves.toEqual({
            isValid: false,
            needsRehash: false,
        });
    });

    it('rejects malformed and unsupported scrypt hashes without treating them as legacy HMAC', async () => {
        const passwordService = createPasswordService();

        await expect(passwordService.verify('password', 'scrypt-v1$1048576$8$1$bad$hash')).resolves.toEqual({
            isValid: false,
            needsRehash: false,
        });
        await expect(passwordService.verify('password', 'scrypt-v1$131072$8$1$bad$hash')).resolves.toEqual({
            isValid: false,
            needsRehash: false,
        });
        await expect(passwordService.verify('password', 'scrypt-v1$131072$8$1$bad$hash$extra')).resolves.toEqual({
            isValid: false,
            needsRehash: false,
        });
    });
});

function createPasswordService(admission = new PasswordKdfAdmission()): PasswordService {
    const config = { get: () => 'legacy-secret' } as unknown as ConfigService<EnvConfig, true>;
    return new PasswordService(config, admission);
}

async function hashWithHistoricalPolicy(password: string): Promise<string> {
    const salt = randomBytes(16);
    const derivedKey = await new Promise<Buffer>((resolve, reject) => {
        scrypt(password, salt, 32, { N: 1 << 16, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }, (error, result) => {
            if (error) {
                reject(error);
                return;
            }
            resolve(result);
        });
    });

    return ['scrypt-v1', 1 << 16, 8, 1, salt.toString('base64url'), derivedKey.toString('base64url')].join('$');
}
