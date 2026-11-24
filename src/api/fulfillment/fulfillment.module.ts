import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Module } from '@nestjs/common';

import { FulfillmentService } from '~/api/fulfillment/application/fulfillment.service.js';
import { FulfillmentEntity } from '~/api/fulfillment/domain/entity/fulfillment.entity.js';
import { FulfillmentResolver } from '~/api/fulfillment/presentation/fulfillment.resolver.js';
import { OrderEntity } from '~/api/order/domain/entity/order.entity.js';

@Module({
    imports: [MikroOrmModule.forFeature([OrderEntity, FulfillmentEntity])],
    providers: [FulfillmentService, FulfillmentResolver],
    exports: [FulfillmentService],
})
export class FulfillmentModule {}
