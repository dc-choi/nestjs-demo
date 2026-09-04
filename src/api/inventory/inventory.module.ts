import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Module } from '@nestjs/common';

import { ItemEntity } from '~/api/catalog/domain/entity/item.entity';
import { InventoryService } from '~/api/inventory/application/inventory.service';
import { InventoryMovementEntity } from '~/api/inventory/domain/inventory-movement.entity';
import { InventoryReservationEntity } from '~/api/inventory/domain/inventory-reservation.entity';
import { InventoryResolver } from '~/api/inventory/presentation/inventory.resolver';

@Module({
    imports: [MikroOrmModule.forFeature([ItemEntity, InventoryReservationEntity, InventoryMovementEntity])],
    providers: [InventoryService, InventoryResolver],
    exports: [InventoryService],
})
export class InventoryModule {}
