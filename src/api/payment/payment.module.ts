import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Module } from '@nestjs/common';

import { InventoryService } from '~/api/inventory/application/inventory.service';
import { InventoryModule } from '~/api/inventory/inventory.module';
import { OrderEntity } from '~/api/order/domain/entity/order.entity';
import { PAYMENT_INVENTORY_PORT } from '~/api/payment/application/payment-inventory.port';
import { PaymentWebhookRecoveryRelay } from '~/api/payment/application/payment-webhook-recovery.relay';
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
        PaymentWebhookRecoveryRelay,
        PaymentResolver,
        { provide: PAYMENT_INVENTORY_PORT, useExisting: InventoryService },
        {
            provide: PAYMENT_WEBHOOK_SIGNATURE_VERIFIER,
            useClass: HmacPaymentWebhookSignatureVerifier,
        },
    ],
    exports: [PaymentService, PaymentWebhookRecoveryRelay],
})
export class PaymentModule {}
