import { ClsPluginTransactional } from '@nestjs-cls/transactional';
import { TransactionalAdapterPrisma } from '@nestjs-cls/transactional-adapter-prisma';
import { RedisModule } from '@nestjs-modules/ioredis';
import { Module, ValidationPipe } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_PIPE } from '@nestjs/core';

import { Request, Response } from 'express';
import Joi from 'joi';
import { WinstonModule } from 'nest-winston';
import { ClsModule } from 'nestjs-cls';
import { randomUUIDv7 } from 'node:crypto';
import { DaoModule } from 'prisma/dao.module';
import { REPOSITORY } from 'prisma/repository';
import { AuthModule } from '~/api/auth/auth.module';
import { CatalogModule } from '~/api/catalog/catalog.module';
import { MemberModule } from '~/api/member/member.module';
import { OrderModule } from '~/api/order/order.module';
import { DistributedLockModule } from '~/global/common/lock/distributed-lock.module';
import { EnvConfig } from '~/global/config/env/env.config';
import { winstonTransports } from '~/global/config/logger/winston.config';
import { GlobalGraphqlModule } from '~/global/graphql/graphql.module';
import { TokenModule } from '~/global/jwt/token.module';
import { MailModule } from '~/infra/mail/mail.module';

@Module({
    imports: [
        // ENV
        ConfigModule.forRoot({
            isGlobal: true,
            envFilePath: '.env',
            validationSchema: Joi.object({
                SERVER_PORT: Joi.number().optional().default(3000),
                DATABASE_URL: Joi.string().required(),
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
            }),
        }),
        // Logger
        WinstonModule.forRoot({
            transports: winstonTransports,
        }),
        // 상위 서비스가 보낸 x-request-id는 형식을 검증하지 않고 그대로 이어서 추적한다.
        // GraphQL도 HTTP transport를 사용하므로 이 middleware가 요청 전체의 requestId를 만든다.
        ClsModule.forRoot({
            global: true,
            middleware: {
                mount: true,
                generateId: true,
                idGenerator: (req: Request) => req.header('x-request-id') || randomUUIDv7(),
                setup: (cls, req: Request, res: Response) => {
                    res.setHeader('x-request-id', cls.getId());
                },
            },
            plugins: [
                new ClsPluginTransactional({
                    adapter: new TransactionalAdapterPrisma({
                        prismaInjectionToken: REPOSITORY,
                    }),
                }),
            ],
        }),
        // Redis
        RedisModule.forRootAsync({
            inject: [ConfigService],
            useFactory: (configService: ConfigService<EnvConfig, true>) => ({
                type: 'single',
                url: configService.get<string>('REDIS_URL'),
            }),
        }),
        DistributedLockModule,
        // Prisma
        DaoModule,
        // Infra
        MailModule,
        // Token
        TokenModule,
        GlobalGraphqlModule,
        // Business Logic
        AuthModule,
        CatalogModule,
        MemberModule,
        OrderModule,
    ],
    providers: [
        {
            provide: APP_PIPE,
            useFactory: () =>
                new ValidationPipe({
                    transform: true,
                    stopAtFirstError: true,
                    // whitelist: true, forbidNonWhitelisted: true, 등 필요 옵션 추가 가능
                }),
        },
    ],
    exports: [],
})
export class AppModule {}
