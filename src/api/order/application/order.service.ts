import { BadRequestException, Inject, Injectable } from '@nestjs/common';

import { randomUUIDv7 } from 'node:crypto';
import { ORDER_REPOSITORY, OrderRepository } from '~/api/order/application/order.repository';
import { PlaceOrderCommand } from '~/api/order/application/place-order.command';
import { Order } from '~/api/order/domain/order';
import { OrderLine } from '~/api/order/domain/order-line';
import { ItemStockShortage, NotExistingItem } from '~/global/common/error/item.error';
import { DistributedLockOptions, DistributedLockService } from '~/global/common/lock/distributed-lock.service';
import { JwtPayload } from '~/global/jwt/payload/jwt.payload';

const ORDER_LOCK_OPTIONS: DistributedLockOptions = {
    ttl: 30_000,
    maxRetries: 3,
    baseDelay: 100,
};

@Injectable()
export class OrderService {
    constructor(
        @Inject(ORDER_REPOSITORY) private readonly orderRepository: OrderRepository,
        private readonly distributedLock: DistributedLockService
    ) {}

    async order(jwtPayload: JwtPayload, command: PlaceOrderCommand) {
        const lockKeys = command.items.map(({ itemId }) => `lock:item:${itemId}`);

        return this.distributedLock.run(lockKeys, () => this.createOrder(jwtPayload, command), ORDER_LOCK_OPTIONS);
    }

    private async createOrder(jwtPayload: JwtPayload, command: PlaceOrderCommand) {
        const { memberId } = jwtPayload;
        return this.orderRepository.transaction(async (transaction) => {
            const orderLines: OrderLine[] = [];

            for (const { itemId, quantity } of command.items) {
                const item = await transaction.findOrderableItem(itemId);
                if (!item) throw new BadRequestException(new NotExistingItem());
                if (item.stock < quantity) throw new BadRequestException(new ItemStockShortage());

                orderLines.push(OrderLine.create({ itemId, quantity, snapshot: item.snapshot }));

                // Redlock은 경합을 줄이고, 이 조건부 차감은 TTL 만료 뒤에도 재고 음수를 막는 최종 경계다.
                const decremented = await transaction.decrementStock(itemId, quantity);
                if (!decremented) throw new BadRequestException(new ItemStockShortage());
            }

            const order = Order.place({
                memberId,
                orderNumber: randomUUIDv7(),
                currencyCode: 'KRW',
                items: orderLines,
            });
            return transaction.save(order);
        });
    }
}
