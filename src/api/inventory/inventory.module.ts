import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Module } from '@nestjs/common';

import { ItemEntity } from '~/api/catalog/domain/entity/item.entity.js';
import { InventoryService } from '~/api/inventory/application/inventory.service.js';
import { InventoryMovementEntity } from '~/api/inventory/domain/inventory-movement.entity.js';
import { InventoryReservationEntity } from '~/api/inventory/domain/inventory-reservation.entity.js';
import { InventoryResolver } from '~/api/inventory/presentation/inventory.resolver.js';

@Module({
    imports: [MikroOrmModule.forFeature([ItemEntity, InventoryReservationEntity, InventoryMovementEntity])],
    providers: [InventoryService, InventoryResolver],
    exports: [InventoryService],
})
export class InventoryModule {}
