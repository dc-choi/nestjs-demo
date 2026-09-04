import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Module } from '@nestjs/common';

import { FulfillmentService } from '~/api/fulfillment/application/fulfillment.service';
import { FulfillmentEntity } from '~/api/fulfillment/domain/fulfillment.entity';
import { FulfillmentResolver } from '~/api/fulfillment/presentation/fulfillment.resolver';
import { OrderEntity } from '~/api/order/domain/entity/order.entity';

@Module({
    imports: [MikroOrmModule.forFeature([OrderEntity, FulfillmentEntity])],
    providers: [FulfillmentService, FulfillmentResolver],
    exports: [FulfillmentService],
})
export class FulfillmentModule {}
