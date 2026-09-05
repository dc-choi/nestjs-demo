import { describe, expect, it } from 'vitest';
import { readMikroOrmEnvironment } from '~/infra/database/database-environment';

const environment = {
    ENV: 'test',
    MYSQL_HOST: 'writer',
    MYSQL_PORT: '3306',
    MYSQL_USER: 'writer-user',
    MYSQL_PASSWORD: 'writer-password',
    MYSQL_DATABASE: 'database',
    MYSQL_READ_REPLICA_HOST: 'replica',
    MYSQL_READ_REPLICA_PORT: '3307',
    MYSQL_READ_REPLICA_USER: 'replica-user',
    MYSQL_READ_REPLICA_PASSWORD: 'replica-password',
    MYSQL_READ_REPLICA_DATABASE: 'database',
};

describe('database environment', () => {
    it('parses primary and replica ports', () => {
        expect(readMikroOrmEnvironment(environment)).toMatchObject({
            MYSQL_HOST: 'writer',
            MYSQL_PORT: 3306,
            MYSQL_READ_REPLICA_HOST: 'replica',
            MYSQL_READ_REPLICA_PORT: 3307,
        });
    });

    it.each([
        ['missing value', { ...environment, MYSQL_HOST: '' }, 'MYSQL_HOST'],
        ['invalid port', { ...environment, MYSQL_PORT: '0' }, 'MYSQL_PORT'],
        ['out-of-range port', { ...environment, MYSQL_PORT: '65536' }, 'MYSQL_PORT'],
    ])('rejects %s', (_case, source, expectedKey) => {
        expect(() => readMikroOrmEnvironment(source)).toThrow(expectedKey);
    });
});
