import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Module } from '@nestjs/common';

import { ItemEntity } from '~/api/catalog/domain/entity/item.entity';
import { InventoryModule } from '~/api/inventory/inventory.module';
import { MemberEntity } from '~/api/member/domain/member.entity';
import { OrderService } from '~/api/order/application/order.service';
import { OrderEntity } from '~/api/order/domain/entity/order.entity';
import { OrderResolver } from '~/api/order/presentation/place-order.resolver';

@Module({
    imports: [MikroOrmModule.forFeature([ItemEntity, MemberEntity, OrderEntity]), InventoryModule],
    providers: [OrderService, OrderResolver],
})
export class OrderModule {}
