import { MiddlewareConsumer, Module, NestModule, RequestMethod, ValidationPipe } from '@nestjs/common';
import { APP_PIPE } from '@nestjs/core';

import { ApplicationModule } from './application.module';

import { PaymentWebhookRecoveryWorker } from '~/api/payment/application/payment-webhook-recovery.worker';
import { PaymentModule } from '~/api/payment/payment.module';
import { RequestContextMiddleware } from '~/global/common/context/request-context';
import { GlobalGraphqlModule } from '~/global/graphql/graphql.module';
import { SearchHttpModule } from '~/infra/search/search-http.module';

@Module({
    imports: [PaymentModule, ApplicationModule, SearchHttpModule, GlobalGraphqlModule],
    providers: [
        PaymentWebhookRecoveryWorker,
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
