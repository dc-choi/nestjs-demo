import { ClsPluginTransactional } from '@nestjs-cls/transactional';
import { TransactionalAdapterPrisma } from '@nestjs-cls/transactional-adapter-prisma';
import { RedisModule } from '@nestjs-modules/ioredis';
import { BullModule } from '@nestjs/bullmq';
import { Module, ValidationPipe } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';

import { DistributedLockInterceptor } from './global/common/lock/DistributedLock.interceptor';

import { Request, Response } from 'express';
import Redis from 'ioredis';
import Joi from 'joi';
import { WinstonModule } from 'nest-winston';
import { ClsModule } from 'nestjs-cls';
import { randomUUIDv7 } from 'node:crypto';
import { DaoModule } from 'prisma/dao.module';
import { REPOSITORY } from 'prisma/repository';
import Redlock from 'redlock';
import { AuthModule } from '~/api/v1/auth/auth.module';
import { MemberModule } from '~/api/v1/member/member.module';
import { OrderModule } from '~/api/v1/order/order.module';
import { OrderV2Module } from '~/api/v2/order/orderV2.module';
import { OrderV3Module } from '~/api/v3/order/orderV3.module';
import { DEFAULT_LOCK_BASE_DELAY, DEFAULT_LOCK_MAX_RETRIES, RED_LOCK } from '~/global/common/lock/DistributedLock';
import { MutexModule } from '~/global/common/lock/mutex.module';
import { EnvConfig } from '~/global/config/env/env.config';
import { winstonTransports } from '~/global/config/logger/winston.config';
import { AllExceptionFilter } from '~/global/filter/all.exception.filter';
import { DefaultExceptionFilter } from '~/global/filter/default.exception.filter';
import { HttpLoggingInterceptor } from '~/global/interceptor/http.logging.interceptor';
import { TokenModule } from '~/global/jwt/token.module';
import { MailModule } from '~/infra/mail/mail.module';
import { QueueModule } from '~/infra/queue/queue.module';

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
        /**
         * Transactional, 요청 단위 추적을 위한 Middleware
         *
         * 각 HTTP 요청마다 고유한 x-request-id를 생성하거나 헤더에서 읽어와서
         * AsyncLocalStorage 컨텍스트에 저장합니다.
         *
         * - 요청 헤더에 x-request-id가 있으면 해당 값을 사용
         * - 없으면 randomUUIDv7()로 새로 생성
         * - 응답 헤더에 x-request-id를 자동으로 추가
         * - 이후 모든 로그에 requestId가 자동으로 포함됨
         */
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
        // BullMQ
        BullModule.forRootAsync({
            inject: [ConfigService],
            useFactory: (configService: ConfigService<EnvConfig, true>) => ({
                connection: {
                    url: configService.get<string>('REDIS_URL'),
                },
            }),
        }),
        QueueModule,
        // Prisma
        DaoModule,
        // Infra
        MailModule,
        // Token
        TokenModule,
        // Mutex
        MutexModule,
        // Business Logic
        AuthModule,
        MemberModule,
        OrderModule,
        OrderV2Module,
        OrderV3Module,
    ],
    providers: [
        {
            provide: APP_INTERCEPTOR,
            useClass: HttpLoggingInterceptor,
        },
        {
            provide: APP_PIPE,
            useFactory: () =>
                new ValidationPipe({
                    transform: true,
                    stopAtFirstError: true,
                    // whitelist: true, forbidNonWhitelisted: true, 등 필요 옵션 추가 가능
                }),
        },
        {
            provide: APP_FILTER,
            useClass: AllExceptionFilter,
        },
        {
            provide: APP_FILTER,
            useClass: DefaultExceptionFilter,
        },
        {
            provide: RED_LOCK,
            inject: [],
            useFactory: (redis: Redis) => {
                return new Redlock([redis], {
                    retryCount: DEFAULT_LOCK_MAX_RETRIES,
                    retryDelay: DEFAULT_LOCK_BASE_DELAY,
                });
            },
        },
        {
            provide: APP_INTERCEPTOR,
            useClass: DistributedLockInterceptor,
        },
    ],
    exports: [],
})
export class AppModule {}
