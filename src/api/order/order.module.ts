import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Module } from '@nestjs/common';

import { ItemEntity } from '~/api/catalog/domain/entity/item.entity';
import { InventoryService } from '~/api/inventory/application/inventory.service';
import { InventoryModule } from '~/api/inventory/inventory.module';
import { MemberEntity } from '~/api/member/domain/member.entity';
import { ORDER_INVENTORY_PORT } from '~/api/order/application/order-inventory.port';
import { OrderService } from '~/api/order/application/order.service';
import { OrderEntity } from '~/api/order/domain/entity/order.entity';
import { OrderResolver } from '~/api/order/presentation/place-order.resolver';

@Module({
    imports: [MikroOrmModule.forFeature([ItemEntity, MemberEntity, OrderEntity]), InventoryModule],
    providers: [OrderService, OrderResolver, { provide: ORDER_INVENTORY_PORT, useExisting: InventoryService }],
})
export class OrderModule {}
