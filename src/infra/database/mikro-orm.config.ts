import { ReflectMetadataProvider } from '@mikro-orm/decorators/legacy';
import { MySqlDriver, type Options as MySqlOptions } from '@mikro-orm/mysql';
import { MikroOrmModuleOptions } from '@mikro-orm/nestjs';
import { ConfigService } from '@nestjs/config';

import type { MikroOrmEnvironment } from './database-environment';
import { databaseEntities } from './entities';
import { MIKRO_ORM_SLOW_QUERY_THRESHOLD_MS, createMikroOrmLogger } from './mikro-orm.logger';

import type { MikroOrmQueryLog, TypedLogger } from '~/global/common/logger/channel.logger';
import { EnvConfig } from '~/global/config/env/env.config';

export type { MikroOrmEnvironment } from './database-environment';

export const createMikroOrmCoreOptions = (
    env: MikroOrmEnvironment,
    sqlLog?: TypedLogger<MikroOrmQueryLog>
): MySqlOptions => {
    return {
        driver: MySqlDriver,
        entities: [...databaseEntities],
        metadataProvider: ReflectMetadataProvider,
        host: env.MYSQL_HOST,
        port: env.MYSQL_PORT,
        user: env.MYSQL_USER,
        password: env.MYSQL_PASSWORD,
        dbName: env.MYSQL_DATABASE,
        name: 'primary',
        replicas: [
            {
                name: 'read-replica-1',
                host: env.MYSQL_READ_REPLICA_HOST,
                port: env.MYSQL_READ_REPLICA_PORT,
                user: env.MYSQL_READ_REPLICA_USER,
                password: env.MYSQL_READ_REPLICA_PASSWORD,
                dbName: env.MYSQL_READ_REPLICA_DATABASE,
            },
        ],
        preferReadReplicas: false,
        forceUtcTimezone: true,
        debug: ['query'],
        colors: false,
        slowQueryThreshold: MIKRO_ORM_SLOW_QUERY_THRESHOLD_MS,
        loggerFactory: (options) => createMikroOrmLogger(options, env.ENV, sqlLog),
    };
};

export const createMikroOrmOptions = (
    configService: ConfigService<EnvConfig, true>,
    sqlLog: TypedLogger<MikroOrmQueryLog>
): MikroOrmModuleOptions<MySqlDriver> => {
    const env: MikroOrmEnvironment = {
        ENV: configService.get<string>('ENV'),
        MYSQL_HOST: configService.get<string>('MYSQL_HOST'),
        MYSQL_PORT: configService.get<number>('MYSQL_PORT'),
        MYSQL_USER: configService.get<string>('MYSQL_USER'),
        MYSQL_PASSWORD: configService.get<string>('MYSQL_PASSWORD'),
        MYSQL_DATABASE: configService.get<string>('MYSQL_DATABASE'),
        MYSQL_READ_REPLICA_HOST: configService.get<string>('MYSQL_READ_REPLICA_HOST'),
        MYSQL_READ_REPLICA_PORT: configService.get<number>('MYSQL_READ_REPLICA_PORT'),
        MYSQL_READ_REPLICA_USER: configService.get<string>('MYSQL_READ_REPLICA_USER'),
        MYSQL_READ_REPLICA_PASSWORD: configService.get<string>('MYSQL_READ_REPLICA_PASSWORD'),
        MYSQL_READ_REPLICA_DATABASE: configService.get<string>('MYSQL_READ_REPLICA_DATABASE'),
    };

    return {
        ...createMikroOrmCoreOptions(env, sqlLog),
        registerRequestContext: true,
    };
};
