import { MODULE_METADATA } from '@nestjs/common/constants';

import { describe, expect, it } from 'vitest';
import { ApplicationModule } from '~/application.module';
import { searchMaintenanceEnvValidationSchema } from '~/global/config/env/search-maintenance-env.validation';
import { DatabaseModule } from '~/infra/database/database.module';
import { SearchModule } from '~/infra/search/search.module';
import { SearchMaintenanceAppModule } from '~/search-maintenance-app.module';

const databaseEnv = {
    MYSQL_HOST: '127.0.0.1',
    MYSQL_PORT: 3306,
    MYSQL_USER: 'search',
    MYSQL_PASSWORD: 'password',
    MYSQL_DATABASE: 'catalog',
    MYSQL_READ_REPLICA_HOST: '127.0.0.1',
    MYSQL_READ_REPLICA_PORT: 3306,
    MYSQL_READ_REPLICA_USER: 'search',
    MYSQL_READ_REPLICA_PASSWORD: 'password',
    MYSQL_READ_REPLICA_DATABASE: 'catalog',
    ENV: 'test',
};

describe('Search maintenance environment', () => {
    it('accepts a database and search-only environment without HTTP-service credentials', () => {
        const { error, value } = searchMaintenanceEnvValidationSchema.validate({
            ...databaseEnv,
            OPENSEARCH_ENABLED: true,
            OPENSEARCH_NODE_URL: 'http://127.0.0.1:9200',
        });

        expect(error).toBeUndefined();
        expect(value).not.toHaveProperty('SECRET');
        expect(value).not.toHaveProperty('REDIS_URL');
        expect(value).not.toHaveProperty('MAIL_USER');
        expect(value).not.toHaveProperty('OPENSEARCH_CURSOR_SECRET');
    });

    it('requires search credentials only when OpenSearch is enabled', () => {
        expect(searchMaintenanceEnvValidationSchema.validate(databaseEnv).error).toBeUndefined();
        expect(
            searchMaintenanceEnvValidationSchema.validate({ ...databaseEnv, OPENSEARCH_ENABLED: true }).error?.message
        ).toContain('OPENSEARCH_NODE_URL');
    });

    it('composes search maintenance without importing the HTTP application module', () => {
        const imports = Reflect.getMetadata(MODULE_METADATA.IMPORTS, SearchMaintenanceAppModule) as unknown[];

        expect(imports).toContain(DatabaseModule);
        expect(imports).toContain(SearchModule);
        expect(imports).not.toContain(ApplicationModule);
    });
});
