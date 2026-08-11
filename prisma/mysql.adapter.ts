import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';

import { EnvConfig } from '~/global/config/env/env.config';

export const PRISMA_ADAPTER = 'PRISMA_ADAPTER';
export const PRISMA_READ_REPLICA_ADAPTER = 'PRISMA_READ_REPLICA_ADAPTER';

export const MysqlAdapterProvider: Provider = {
    provide: PRISMA_ADAPTER,
    useFactory: (configService: ConfigService<EnvConfig, true>) => {
        return new PrismaMariaDb({
            host: configService.get<string>('MYSQL_HOST'),
            port: configService.get<number>('MYSQL_PORT'),
            user: configService.get<string>('MYSQL_USER'),
            password: configService.get<string>('MYSQL_PASSWORD'),
            database: configService.get<string>('MYSQL_DATABASE'),
        });
    },
    inject: [ConfigService],
};

export const MysqlReadReplicaAdapterProvider: Provider = {
    provide: PRISMA_READ_REPLICA_ADAPTER,
    useFactory: (configService: ConfigService<EnvConfig, true>) => {
        // 이 provider는 별도 연결만 만든다. 복제와 장애 전환, 읽기 전용 권한은 DB에서 보장해야 한다.
        return new PrismaMariaDb({
            host: configService.get<string>('MYSQL_READ_REPLICA_HOST'),
            port: configService.get<number>('MYSQL_READ_REPLICA_PORT'),
            user: configService.get<string>('MYSQL_READ_REPLICA_USER'),
            password: configService.get<string>('MYSQL_READ_REPLICA_PASSWORD'),
            database: configService.get<string>('MYSQL_READ_REPLICA_DATABASE'),
        });
    },
    inject: [ConfigService],
};
