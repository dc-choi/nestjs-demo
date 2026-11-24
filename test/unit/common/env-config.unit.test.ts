import { ConfigService } from '@nestjs/config';

import { describe, expect, it } from 'vitest';
import type { EnvConfig } from '~/global/config/env/env.config.js';
import { envValidationSchema } from '~/global/config/env/env.validation.js';
import { resolveJwtSecret } from '~/global/jwt/jwt-secret.js';

const requiredEnv = {
    MYSQL_HOST: '127.0.0.1',
    MYSQL_PORT: '3306',
    MYSQL_USER: 'user',
    MYSQL_PASSWORD: 'password',
    MYSQL_DATABASE: 'database',
    MYSQL_READ_REPLICA_HOST: '127.0.0.1',
    MYSQL_READ_REPLICA_PORT: '3306',
    MYSQL_READ_REPLICA_USER: 'user',
    MYSQL_READ_REPLICA_PASSWORD: 'password',
    MYSQL_READ_REPLICA_DATABASE: 'database',
    SECRET: 'legacy-secret',
    ENV: 'test',
    MAIL_USER: 'mail@example.com',
    MAIL_PASSWORD: 'mail-password',
    MAIL_SIGNUP_ALERT_USER: 'mail@example.com',
    REDIS_URL: 'redis://127.0.0.1:6379',
};

describe('application env validation', () => {
    it('leaves TRUST_PROXY unset by default so req.ip stays the TCP peer', () => {
        const { error, value } = envValidationSchema.validate(requiredEnv);

        expect(error).toBeUndefined();
        expect(value).not.toHaveProperty('TRUST_PROXY');
    });

    it.each([
        ['1', 1],
        ['loopback, 10.0.0.0/8', 'loopback, 10.0.0.0/8'],
    ])('converts TRUST_PROXY=%s to the Express setting %j', (raw, expected) => {
        const { error, value } = envValidationSchema.validate({ ...requiredEnv, TRUST_PROXY: raw });

        expect(error).toBeUndefined();
        expect(value?.TRUST_PROXY).toBe(expected);
    });

    it.each(['true', 'FALSE'])('rejects TRUST_PROXY=%s because trust-all lets clients forge their IP', (raw) => {
        expect(envValidationSchema.validate({ ...requiredEnv, TRUST_PROXY: raw }).error?.message).toContain(
            'TRUST_PROXY'
        );
    });

    it('requires a dedicated JWT_SECRET to be at least 32 characters', () => {
        expect(envValidationSchema.validate({ ...requiredEnv, JWT_SECRET: 'short' }).error?.message).toContain(
            'JWT_SECRET'
        );
    });
});

describe('resolveJwtSecret', () => {
    it('prefers JWT_SECRET and falls back to the legacy SECRET', () => {
        const jwtSecret = 'dedicated-jwt-secret-with-32-characters';

        expect(resolveJwtSecret(config({ JWT_SECRET: jwtSecret, SECRET: 'legacy-secret' }))).toBe(jwtSecret);
        expect(resolveJwtSecret(config({ SECRET: 'legacy-secret' }))).toBe('legacy-secret');
    });
});

function config(values: Record<string, unknown>): ConfigService<EnvConfig, true> {
    // Explicit nulls keep the shell environment out of ConfigService; `??` still treats them as missing.
    return new ConfigService({ JWT_SECRET: null, SECRET: null, ...values }) as unknown as ConfigService<
        EnvConfig,
        true
    >;
}
