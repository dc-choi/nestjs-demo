import type { SearchMaintenanceEnvConfig } from './search-maintenance-env.config';

import Joi from 'joi';

export const searchMaintenanceEnvValidationSchema = Joi.object<SearchMaintenanceEnvConfig>({
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
    ENV: Joi.string().required(),
    OPENSEARCH_ENABLED: Joi.boolean().optional().default(false),
    OPENSEARCH_NODE_URL: Joi.string()
        .uri({ scheme: ['http', 'https'] })
        .when('OPENSEARCH_ENABLED', { is: true, then: Joi.required(), otherwise: Joi.optional() }),
    OPENSEARCH_READ_ALIAS: Joi.string().optional().default('catalog-products-read'),
    OPENSEARCH_WRITE_ALIAS: Joi.string().optional().default('catalog-products-write'),
    OPENSEARCH_REQUEST_TIMEOUT_MS: Joi.number().integer().min(100).max(30_000).optional().default(5_000),
});
