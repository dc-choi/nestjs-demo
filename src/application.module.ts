import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AuthModule } from '~/api/auth/auth.module.js';
import { CatalogModule } from '~/api/catalog/catalog.module.js';
import { FulfillmentModule } from '~/api/fulfillment/fulfillment.module.js';
import { InventoryModule } from '~/api/inventory/inventory.module.js';
import { MemberModule } from '~/api/member/member.module.js';
import { OrderModule } from '~/api/order/order.module.js';
import { PaymentModule } from '~/api/payment/payment.module.js';
import { DistributedLockModule } from '~/global/common/lock/distributed-lock.module.js';
import { envValidationSchema } from '~/global/config/env/env.validation.js';
import { LoggingModule } from '~/global/config/logger/logging.module.js';
import { TokenModule } from '~/global/jwt/token.module.js';
import { DatabaseModule } from '~/infra/database/database.module.js';
import { MailModule } from '~/infra/mail/mail.module.js';
import { RedisClientModule } from '~/infra/redis/redis-client.module.js';

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
