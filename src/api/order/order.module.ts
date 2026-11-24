import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Module } from '@nestjs/common';

import { ItemEntity } from '~/api/catalog/domain/entity/item.entity.js';
import { InventoryService } from '~/api/inventory/application/inventory.service.js';
import { InventoryReservationEntity } from '~/api/inventory/domain/entity/inventory-reservation.entity.js';
import { InventoryModule } from '~/api/inventory/inventory.module.js';
import { MemberEntity } from '~/api/member/domain/entity/member.entity.js';
import { OrderExpirationService } from '~/api/order/application/order-expiration.service.js';
import { ORDER_INVENTORY_PORT } from '~/api/order/application/order-inventory.port.js';
import { OrderService } from '~/api/order/application/order.service.js';
import { OrderEntity } from '~/api/order/domain/entity/order.entity.js';
import { OrderExpirationResolver } from '~/api/order/presentation/order-expiration.resolver.js';
import { OrderResolver } from '~/api/order/presentation/place-order.resolver.js';

@Module({
    imports: [
        MikroOrmModule.forFeature([ItemEntity, MemberEntity, OrderEntity, InventoryReservationEntity]),
        InventoryModule,
    ],
    providers: [
        OrderService,
        OrderExpirationService,
        OrderResolver,
        OrderExpirationResolver,
        { provide: ORDER_INVENTORY_PORT, useExisting: InventoryService },
    ],
    exports: [OrderExpirationService],
})
export class OrderModule {}
