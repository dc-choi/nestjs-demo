import { MikroORM } from '@mikro-orm/core';
import { MySqlDriver } from '@mikro-orm/mysql';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Global, Injectable, Module, OnModuleInit } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { createMikroOrmOptions } from './mikro-orm.config';

import { SQL_LOGGER } from '~/global/common/logger/channel.logger';
import { LoggingModule } from '~/global/config/logger/logging.module';

@Injectable()
class DatabaseConnectionLifecycle implements OnModuleInit {
    constructor(private readonly orm: MikroORM) {}

    async onModuleInit(): Promise<void> {
        // v7 initializes lazily, while connect() opens the writer and every configured replica.
        // Await it here so an unavailable database fails application boot.
        await this.orm.connect();
    }
}

@Global()
@Module({
    imports: [
        MikroOrmModule.forRootAsync({
            driver: MySqlDriver,
            imports: [ConfigModule, LoggingModule],
            inject: [ConfigService, SQL_LOGGER],
            useFactory: createMikroOrmOptions,
        }),
    ],
    providers: [DatabaseConnectionLifecycle],
})
export class DatabaseModule {}
