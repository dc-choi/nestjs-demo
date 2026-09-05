import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AuthModule } from '~/api/auth/auth.module';
import { CatalogModule } from '~/api/catalog/catalog.module';
import { FulfillmentModule } from '~/api/fulfillment/fulfillment.module';
import { InventoryModule } from '~/api/inventory/inventory.module';
import { MemberModule } from '~/api/member/member.module';
import { OrderModule } from '~/api/order/order.module';
import { PaymentModule } from '~/api/payment/payment.module';
import { DistributedLockModule } from '~/global/common/lock/distributed-lock.module';
import { envValidationSchema } from '~/global/config/env/env.validation';
import { LoggingModule } from '~/global/config/logger/logging.module';
import { TokenModule } from '~/global/jwt/token.module';
import { DatabaseModule } from '~/infra/database/database.module';
import { MailModule } from '~/infra/mail/mail.module';
import { RedisClientModule } from '~/infra/redis/redis-client.module';

@Module({
    imports: [
        ConfigModule.forRoot({
            isGlobal: true,
            envFilePath: '.env',
            validationSchema: envValidationSchema,
        }),
        LoggingModule,
        RedisClientModule,
        DistributedLockModule,
        DatabaseModule,
        MailModule,
        TokenModule,
        AuthModule,
        CatalogModule,
        InventoryModule,
        MemberModule,
        OrderModule,
        PaymentModule,
        FulfillmentModule,
    ],
})
export class ApplicationModule {}
