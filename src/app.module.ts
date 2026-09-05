import { MiddlewareConsumer, Module, NestModule, RequestMethod, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_PIPE } from '@nestjs/core';

import { AuthModule } from '~/api/auth/auth.module';
import { CatalogModule } from '~/api/catalog/catalog.module';
import { FulfillmentModule } from '~/api/fulfillment/fulfillment.module';
import { InventoryModule } from '~/api/inventory/inventory.module';
import { MemberModule } from '~/api/member/member.module';
import { OrderModule } from '~/api/order/order.module';
import { PaymentModule } from '~/api/payment/payment.module';
import { RequestContextMiddleware } from '~/global/common/context/request-context';
import { DistributedLockModule } from '~/global/common/lock/distributed-lock.module';
import { envValidationSchema } from '~/global/config/env/env.validation';
import { GlobalGraphqlModule } from '~/global/graphql/graphql.module';
import { TokenModule } from '~/global/jwt/token.module';
import { DatabaseModule } from '~/infra/database/database.module';
import { MailModule } from '~/infra/mail/mail.module';
import { RedisClientModule } from '~/infra/redis/redis-client.module';
import { SearchModule } from '~/infra/search/search.module';

@Module({
    imports: [
        // ENV
        ConfigModule.forRoot({
            isGlobal: true,
            envFilePath: '.env',
            validationSchema: envValidationSchema,
        }),
        // Redis
        RedisClientModule,
        DistributedLockModule,
        // Infra
        DatabaseModule,
        MailModule,
        SearchModule,
        // Token
        TokenModule,
        // Graphql
        GlobalGraphqlModule,
        // Business Logic
        AuthModule,
        CatalogModule,
        InventoryModule,
        MemberModule,
        OrderModule,
        PaymentModule,
        FulfillmentModule,
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
export class AppModule implements NestModule {
    configure(consumer: MiddlewareConsumer): void {
        // 상위 서비스가 보낸 x-request-id는 형식을 검증하지 않고 그대로 이어서 추적한다.
        // GraphQL도 HTTP transport를 사용하므로 이 middleware가 요청 전체의 requestId를 만든다.
        consumer.apply(RequestContextMiddleware).forRoutes({ path: '{*path}', method: RequestMethod.ALL });
    }
}
