import type { EnvConfig } from './env.config';

import Joi from 'joi';

export const envValidationSchema = Joi.object<EnvConfig>({
    SERVER_PORT: Joi.number().optional().default(3000),
    MYSQL_HOST: Joi.string().required(),
    MYSQL_PORT: Joi.number().required(),
    MYSQL_USER: Joi.string().required(),
    MYSQL_PASSWORD: Joi.string().required(),
    MYSQL_DATABASE: Joi.string().required(),
    MYSQL_READ_REPLICA_HOST: Joi.string().required(),
    MYSQL_READ_REPLICA_PORT: Joi.number().required(),
    MYSQL_READ_REPLICA_USER: Joi.string().required(),
    MYSQL_READ_REPLICA_PASSWORD: Joi.string().required(),
    MYSQL_READ_REPLICA_DATABASE: Joi.string().required(),
    SECRET: Joi.string().required(),
    ENV: Joi.string().required(),
    MAIL_USER: Joi.string().required(),
    MAIL_PASSWORD: Joi.string().required(),
    MAIL_SIGNUP_ALERT_USER: Joi.string().required(),
    REDIS_URL: Joi.string().required(),
    PAYMENT_WEBHOOK_SECRET: Joi.string().min(32).optional(),
    OPENSEARCH_ENABLED: Joi.boolean().optional().default(false),
    OPENSEARCH_NODE_URL: Joi.string()
        .uri({ scheme: ['http', 'https'] })
        .optional(),
    OPENSEARCH_READ_ALIAS: Joi.string().optional().default('catalog-products-read'),
    OPENSEARCH_WRITE_ALIAS: Joi.string().optional().default('catalog-products-write'),
    OPENSEARCH_CURSOR_SECRET: Joi.string().min(32).optional(),
    OPENSEARCH_REQUEST_TIMEOUT_MS: Joi.number().integer().min(100).max(30_000).optional().default(5_000),
});

export const validateEnvConfig = (source: NodeJS.ProcessEnv | Record<string, unknown>): EnvConfig => {
    const { error, value } = envValidationSchema.validate(source, {
        abortEarly: false,
        allowUnknown: true,
    });

    if (error) throw new Error(`Config validation error: ${error.message}`);
    return value;
};
