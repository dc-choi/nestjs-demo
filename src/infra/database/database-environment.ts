import type { EnvConfig } from '~/global/config/env/env.config';

export type MikroOrmEnvironment = Pick<
    EnvConfig,
    | 'ENV'
    | 'MYSQL_HOST'
    | 'MYSQL_PORT'
    | 'MYSQL_USER'
    | 'MYSQL_PASSWORD'
    | 'MYSQL_DATABASE'
    | 'MYSQL_READ_REPLICA_HOST'
    | 'MYSQL_READ_REPLICA_PORT'
    | 'MYSQL_READ_REPLICA_USER'
    | 'MYSQL_READ_REPLICA_PASSWORD'
    | 'MYSQL_READ_REPLICA_DATABASE'
>;

export function readMikroOrmEnvironment(source: NodeJS.ProcessEnv): MikroOrmEnvironment {
    return {
        ENV: requiredString(source, 'ENV'),
        MYSQL_HOST: requiredString(source, 'MYSQL_HOST'),
        MYSQL_PORT: requiredPort(source, 'MYSQL_PORT'),
        MYSQL_USER: requiredString(source, 'MYSQL_USER'),
        MYSQL_PASSWORD: requiredString(source, 'MYSQL_PASSWORD'),
        MYSQL_DATABASE: requiredString(source, 'MYSQL_DATABASE'),
        MYSQL_READ_REPLICA_HOST: requiredString(source, 'MYSQL_READ_REPLICA_HOST'),
        MYSQL_READ_REPLICA_PORT: requiredPort(source, 'MYSQL_READ_REPLICA_PORT'),
        MYSQL_READ_REPLICA_USER: requiredString(source, 'MYSQL_READ_REPLICA_USER'),
        MYSQL_READ_REPLICA_PASSWORD: requiredString(source, 'MYSQL_READ_REPLICA_PASSWORD'),
        MYSQL_READ_REPLICA_DATABASE: requiredString(source, 'MYSQL_READ_REPLICA_DATABASE'),
    };
}

function requiredString(source: NodeJS.ProcessEnv, key: keyof MikroOrmEnvironment): string {
    const value = source[key];
    if (!value) throw new Error(`Missing required environment variable: ${key}`);
    return value;
}

function requiredPort(source: NodeJS.ProcessEnv, key: 'MYSQL_PORT' | 'MYSQL_READ_REPLICA_PORT'): number {
    const port = Number(requiredString(source, key));
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
        throw new Error(`Environment variable ${key} must be a valid TCP port`);
    }
    return port;
}
