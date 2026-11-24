import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Module } from '@nestjs/common';

import { Redis } from 'ioredis';
import Redlock from 'redlock';
import { ItemEntity } from '~/api/catalog/domain/entity/item.entity.js';
import { InventoryService } from '~/api/inventory/application/inventory.service.js';
import { InventoryReservationEntity } from '~/api/inventory/domain/entity/inventory-reservation.entity.js';
import { InventoryModule } from '~/api/inventory/inventory.module.js';
import { MemberEntity } from '~/api/member/domain/entity/member.entity.js';
import { OrderExpirationService } from '~/api/order/application/order-expiration.service.js';
import { ORDER_INVENTORY_PORT } from '~/api/order/application/order-inventory.port.js';
import { OrderService } from '~/api/order/application/order.service.js';
import { OrderEntity } from '~/api/order/domain/entity/order.entity.js';
import { DistributedLockService } from '~/api/order/infrastructure/distributed-lock.service.js';
import { RED_LOCK } from '~/api/order/infrastructure/distributed-lock.symbol.js';
import { OrderExpirationResolver } from '~/api/order/presentation/order-expiration.resolver.js';
import { OrderResolver } from '~/api/order/presentation/order.resolver.js';
import { REDIS_CLIENT } from '~/infra/redis/redis-client.symbol.js';

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
        {
            provide: RED_LOCK,
            inject: [REDIS_CLIENT],
            // 획득 시도 횟수와 지연은 호출부 설정을 받는 DistributedLockService 한 곳에서만 제어한다.
            // redlock 4 타입은 ioredis 4의 배열형 eval overload를 고정하지만 ioredis 6도 이를 runtime에서 지원한다.
            useFactory: (redis: Redis) =>
                new Redlock([redis as unknown as Redlock.CompatibleRedisClient], { retryCount: 0 }),
        },
        DistributedLockService,
    ],
    exports: [OrderExpirationService],
})
export class OrderModule {}
