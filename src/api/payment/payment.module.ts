import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Module } from '@nestjs/common';

import { InventoryModule } from '~/api/inventory/inventory.module';
import { OrderEntity } from '~/api/order/domain/entity/order.entity';
import { PaymentService } from '~/api/payment/application/payment.service';
import { PaymentAttemptEntity } from '~/api/payment/domain/payment-attempt.entity';
import { PaymentTransactionEntity } from '~/api/payment/domain/payment-transaction.entity';
import { PaymentWebhookEventEntity } from '~/api/payment/domain/payment-webhook-event.entity';
import {
    HmacPaymentWebhookSignatureVerifier,
    PAYMENT_WEBHOOK_SIGNATURE_VERIFIER,
} from '~/api/payment/infrastructure/payment-webhook-signature.verifier';
import { PaymentWebhookController } from '~/api/payment/presentation/payment-webhook.controller';
import { PaymentResolver } from '~/api/payment/presentation/payment.resolver';

@Module({
    imports: [
        MikroOrmModule.forFeature([
            OrderEntity,
            PaymentAttemptEntity,
            PaymentTransactionEntity,
            PaymentWebhookEventEntity,
        ]),
        InventoryModule,
    ],
    controllers: [PaymentWebhookController],
    providers: [
        PaymentService,
        PaymentResolver,
        {
            provide: PAYMENT_WEBHOOK_SIGNATURE_VERIFIER,
            useClass: HmacPaymentWebhookSignatureVerifier,
        },
    ],
    exports: [PaymentService],
})
export class PaymentModule {}
