import { PasswordKdfAdmission } from './password-kdf.admission';

import { createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const PASSWORD_HASH_VERSION = 'scrypt-v1';
const SCRYPT_COST = 1 << 17;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;
const SALT_BYTES = 16;
const DERIVED_KEY_BYTES = 32;
const SCRYPT_MAX_MEMORY = 256 * 1024 * 1024;
const DUMMY_SALT = Buffer.alloc(SALT_BYTES);
const passwordKdfAdmission = new PasswordKdfAdmission();

export interface PasswordVerification {
    isValid: boolean;
    needsRehash: boolean;
}

export class MemberDomain {
    public static async hashPassword(password: string): Promise<string> {
        const salt = randomBytes(SALT_BYTES);
        const derivedKey = await deriveScrypt(password, salt);

        return [
            PASSWORD_HASH_VERSION,
            SCRYPT_COST,
            SCRYPT_BLOCK_SIZE,
            SCRYPT_PARALLELIZATION,
            salt.toString('base64url'),
            derivedKey.toString('base64url'),
        ].join('$');
    }

    public static async verifyPassword(
        password: string,
        storedHash: string | null,
        legacySecret: string
    ): Promise<PasswordVerification> {
        const currentHash = storedHash ? parseCurrentHash(storedHash) : null;
        // Missing, passwordless and legacy accounts pay the same KDF cost on rejection.
        const derivedKey = await deriveScrypt(password, currentHash?.salt ?? DUMMY_SALT);
        if (currentHash) {
            return {
                isValid: timingSafeEqual(derivedKey, currentHash.derivedKey),
                needsRehash: false,
            };
        }
        if (!storedHash) return { isValid: false, needsRehash: false };

        const expected = Buffer.from(this.generateLegacyHashedPassword(password, legacySecret), 'base64');
        const actual = Buffer.from(storedHash, 'base64');
        const isValid = actual.length === expected.length && timingSafeEqual(actual, expected);

        return { isValid, needsRehash: isValid };
    }

    /** Legacy HMAC is retained only to authenticate and upgrade existing rows. */
    public static generateLegacyHashedPassword(password: string, secret: string): string {
        return createHmac('sha256', secret).update(password).digest('base64');
    }
}

async function deriveScrypt(password: string, salt: Buffer): Promise<Buffer> {
    return passwordKdfAdmission.run(
        () =>
            new Promise((resolve, reject) => {
                scrypt(
                    password,
                    salt,
                    DERIVED_KEY_BYTES,
                    {
                        N: SCRYPT_COST,
                        r: SCRYPT_BLOCK_SIZE,
                        p: SCRYPT_PARALLELIZATION,
                        maxmem: SCRYPT_MAX_MEMORY,
                    },
                    (error, derivedKey) => {
                        if (error) {
                            reject(error);
                            return;
                        }
                        resolve(derivedKey);
                    }
                );
            })
    );
}

function parseCurrentHash(storedHash: string): { salt: Buffer; derivedKey: Buffer } | null {
    const [version, cost, blockSize, parallelization, encodedSalt, encodedDerivedKey] = storedHash.split('$');
    if (
        version !== PASSWORD_HASH_VERSION ||
        cost !== String(SCRYPT_COST) ||
        blockSize !== String(SCRYPT_BLOCK_SIZE) ||
        parallelization !== String(SCRYPT_PARALLELIZATION) ||
        !encodedSalt ||
        !encodedDerivedKey
    ) {
        return null;
    }

    const salt = Buffer.from(encodedSalt, 'base64url');
    const derivedKey = Buffer.from(encodedDerivedKey, 'base64url');
    if (
        salt.length !== SALT_BYTES ||
        derivedKey.length !== DERIVED_KEY_BYTES ||
        salt.toString('base64url') !== encodedSalt ||
        derivedKey.toString('base64url') !== encodedDerivedKey
    ) {
        return null;
    }

    return { salt, derivedKey };
}
