import type { EnvConfig } from './env.config.js';

import Joi from 'joi';

// OpenSearch 값의 기본값은 OpenSearchConfig 한 곳이 소유한다. 여기서는 형식만 검사한다.
export const envValidationSchema = Joi.object<EnvConfig>({
    SERVER_PORT: Joi.number().optional().default(3000),
    // Express `trust proxy`: 앞단 proxy hop 수 또는 쉼표로 구분한 proxy 주소/CIDR. 숫자 문자열은 hop 수로 바꾼다.
    // 모든 proxy를 믿는 true는 클라이언트가 보낸 X-Forwarded-For를 그대로 믿게 되므로 받지 않는다.
    TRUST_PROXY: Joi.alternatives()
        .try(Joi.number().integer().min(0), Joi.string().invalid('true', 'false').insensitive())
        .optional(),
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
    JWT_SECRET: Joi.string().min(32).optional(),
    ENV: Joi.string().required(),
    MAIL_USER: Joi.string().required(),
    MAIL_PASSWORD: Joi.string().required(),
    MAIL_SIGNUP_ALERT_USER: Joi.string().required(),
    REDIS_URL: Joi.string().required(),
    PAYMENT_WEBHOOK_SECRET: Joi.string().min(32).optional(),
    OPENSEARCH_ENABLED: Joi.boolean().optional(),
    OPENSEARCH_NODE_URL: Joi.string()
        .uri({ scheme: ['http', 'https'] })
        .optional(),
    OPENSEARCH_READ_ALIAS: Joi.string().optional(),
    OPENSEARCH_WRITE_ALIAS: Joi.string().optional(),
    OPENSEARCH_CURSOR_SECRET: Joi.string().min(32).optional(),
    OPENSEARCH_REQUEST_TIMEOUT_MS: Joi.number().integer().min(100).max(30_000).optional(),
});
