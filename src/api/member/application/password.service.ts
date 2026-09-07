import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PasswordKdfAdmission } from './password-kdf.admission';

import { createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { EnvConfig } from '~/global/config/env/env.config';

const PASSWORD_HASH_VERSION = 'scrypt-v1';
const SALT_BYTES = 16;
const DERIVED_KEY_BYTES = 32;
const SCRYPT_MAX_MEMORY = 256 * 1024 * 1024;
const DUMMY_SALT = Buffer.alloc(SALT_BYTES);
const SCRYPT_V1_CURRENT_POLICY: ScryptPolicy = { cost: 1 << 17, blockSize: 8, parallelization: 1 };
const SCRYPT_V1_HISTORICAL_POLICY: ScryptPolicy = { cost: 1 << 16, blockSize: 8, parallelization: 1 };
const ACCEPTED_POLICIES: readonly ScryptPolicy[] = [SCRYPT_V1_CURRENT_POLICY, SCRYPT_V1_HISTORICAL_POLICY];
const WRITE_POLICY = SCRYPT_V1_CURRENT_POLICY;

export interface PasswordVerification {
    isValid: boolean;
    needsRehash: boolean;
}

@Injectable()
export class PasswordService {
    constructor(
        private readonly config: ConfigService<EnvConfig, true>,
        private readonly admission: PasswordKdfAdmission
    ) {}

    async hash(password: string): Promise<string> {
        const salt = randomBytes(SALT_BYTES);
        const derivedKey = await this.derive(password, salt, WRITE_POLICY);

        return formatScryptHash(salt, derivedKey, WRITE_POLICY);
    }

    async verify(password: string, storedHash: string | null): Promise<PasswordVerification> {
        const parsedHash = storedHash ? parseScryptHash(storedHash) : null;
        const derivedKey = await this.derive(
            password,
            parsedHash?.salt ?? DUMMY_SALT,
            parsedHash?.policy ?? WRITE_POLICY
        );
        if (parsedHash) {
            const isValid = timingSafeEqual(derivedKey, parsedHash.derivedKey);
            return {
                isValid,
                needsRehash: isValid && !isWritePolicy(parsedHash.policy),
            };
        }
        if (!storedHash || isScryptHash(storedHash)) return { isValid: false, needsRehash: false };

        const expected = Buffer.from(this.legacyHash(password), 'base64');
        const actual = Buffer.from(storedHash, 'base64');
        const isValid = actual.length === expected.length && timingSafeEqual(actual, expected);

        return { isValid, needsRehash: isValid };
    }

    private legacyHash(password: string): string {
        return createHmac('sha256', this.config.get<string>('SECRET')).update(password).digest('base64');
    }

    private async derive(password: string, salt: Buffer, policy: ScryptPolicy): Promise<Buffer> {
        return this.admission.run(
            () =>
                new Promise((resolve, reject) => {
                    scrypt(
                        password,
                        salt,
                        DERIVED_KEY_BYTES,
                        {
                            N: policy.cost,
                            r: policy.blockSize,
                            p: policy.parallelization,
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
}

interface ScryptPolicy {
    cost: number;
    blockSize: number;
    parallelization: number;
}

interface ParsedScryptHash {
    salt: Buffer;
    derivedKey: Buffer;
    policy: ScryptPolicy;
}

function formatScryptHash(salt: Buffer, derivedKey: Buffer, policy: ScryptPolicy): string {
    return [
        PASSWORD_HASH_VERSION,
        policy.cost,
        policy.blockSize,
        policy.parallelization,
        salt.toString('base64url'),
        derivedKey.toString('base64url'),
    ].join('$');
}

function parseScryptHash(storedHash: string): ParsedScryptHash | null {
    const segments = storedHash.split('$');
    if (segments.length !== 6) return null;

    const [version, cost, blockSize, parallelization, encodedSalt, encodedDerivedKey] = segments;
    const policy = ACCEPTED_POLICIES.find(
        (candidate) =>
            version === PASSWORD_HASH_VERSION &&
            cost === String(candidate.cost) &&
            blockSize === String(candidate.blockSize) &&
            parallelization === String(candidate.parallelization)
    );
    if (!policy || !encodedSalt || !encodedDerivedKey) return null;

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

    return { salt, derivedKey, policy };
}

function isScryptHash(storedHash: string): boolean {
    return storedHash.startsWith('scrypt-');
}

function isWritePolicy(policy: ScryptPolicy): boolean {
    return (
        policy.cost === WRITE_POLICY.cost &&
        policy.blockSize === WRITE_POLICY.blockSize &&
        policy.parallelization === WRITE_POLICY.parallelization
    );
}
