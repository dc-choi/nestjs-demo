import { ReflectMetadataProvider } from '@mikro-orm/decorators/legacy';
import { MySqlDriver } from '@mikro-orm/mysql';
import type { ConfigService } from '@nestjs/config';

import { describe, expect, it } from 'vitest';
import type { EnvConfig } from '~/global/config/env/env.config';
import { createMikroOrmOptions } from '~/infra/database/mikro-orm.config';

describe('MikroORM config', () => {
    it('25개 엔티티와 writer/replica 운영 기본값을 명시한다', () => {
        const env: EnvConfig = {
            SERVER_PORT: 3000,
            MYSQL_HOST: 'writer',
            MYSQL_PORT: 3306,
            MYSQL_USER: 'writer-user',
            MYSQL_PASSWORD: 'writer-password',
            MYSQL_DATABASE: 'database',
            MYSQL_READ_REPLICA_HOST: 'replica',
            MYSQL_READ_REPLICA_PORT: 3307,
            MYSQL_READ_REPLICA_USER: 'replica-user',
            MYSQL_READ_REPLICA_PASSWORD: 'replica-password',
            MYSQL_READ_REPLICA_DATABASE: 'database',
            SECRET: 'secret',
            ENV: 'test',
            MAIL_USER: 'mail-user',
            MAIL_PASSWORD: 'mail-password',
            MAIL_SIGNUP_ALERT_USER: 'mail-alert-user',
            REDIS_URL: 'redis://localhost:6379',
            PAYMENT_WEBHOOK_SECRET: 'test-payment-webhook-secret-32-chars',
        };
        const configService = {
            get: <T>(key: keyof EnvConfig): T => env[key] as T,
        } as ConfigService<EnvConfig, true>;

        const options = createMikroOrmOptions(configService, { log: () => undefined });

        expect(options).toMatchObject({
            driver: MySqlDriver,
            metadataProvider: ReflectMetadataProvider,
            host: 'writer',
            port: 3306,
            name: 'primary',
            preferReadReplicas: false,
            registerRequestContext: true,
            debug: ['query'],
            slowQueryThreshold: 500,
        });
        expect(options.entities).toHaveLength(25);
        expect(options.replicas).toEqual([
            expect.objectContaining({
                name: 'read-replica-1',
                host: 'replica',
                port: 3307,
            }),
        ]);
    });
});
