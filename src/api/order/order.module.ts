import { Module } from '@nestjs/common';

import { ORDER_REPOSITORY } from '~/api/order/application/order.repository';
import { OrderService } from '~/api/order/application/order.service';
import { PrismaOrderRepository } from '~/api/order/infrastructure/prisma-order.repository';
import { OrderResolver } from '~/api/order/presentation/place-order.resolver';

@Module({
    providers: [
        OrderService,
        {
            provide: ORDER_REPOSITORY,
            useClass: PrismaOrderRepository,
        },
        OrderResolver,
    ],
})
export class OrderModule {}
