import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Module } from '@nestjs/common';

import { InventoryService } from '~/api/inventory/application/inventory.service.js';
import { InventoryModule } from '~/api/inventory/inventory.module.js';
import { OrderEntity } from '~/api/order/domain/entity/order.entity.js';
import { PAYMENT_INVENTORY_PORT } from '~/api/payment/application/payment-inventory.port.js';
import { PaymentWebhookRecoveryRelay } from '~/api/payment/application/payment-webhook-recovery.relay.js';
import { PAYMENT_WEBHOOK_SIGNATURE_VERIFIER } from '~/api/payment/application/payment-webhook-signature-verifier.port.js';
import { PaymentWebhookService } from '~/api/payment/application/payment-webhook.service.js';
import { PaymentService } from '~/api/payment/application/payment.service.js';
import { PaymentAttemptEntity } from '~/api/payment/domain/entity/payment-attempt.entity.js';
import { PaymentTransactionEntity } from '~/api/payment/domain/entity/payment-transaction.entity.js';
import { PaymentWebhookEventEntity } from '~/api/payment/domain/entity/payment-webhook-event.entity.js';
import { HmacPaymentWebhookSignatureVerifier } from '~/api/payment/infrastructure/payment-webhook-signature.verifier.js';
import { PaymentWebhookController } from '~/api/payment/presentation/payment-webhook.controller.js';
import { PaymentResolver } from '~/api/payment/presentation/payment.resolver.js';

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
        PaymentWebhookService,
        PaymentWebhookRecoveryRelay,
        PaymentResolver,
        { provide: PAYMENT_INVENTORY_PORT, useExisting: InventoryService },
        {
            provide: PAYMENT_WEBHOOK_SIGNATURE_VERIFIER,
            useClass: HmacPaymentWebhookSignatureVerifier,
        },
    ],
    exports: [PaymentService, PaymentWebhookService, PaymentWebhookRecoveryRelay],
})
export class PaymentModule {}
