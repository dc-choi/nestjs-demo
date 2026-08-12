import { TransactionHost, Transactional } from '@nestjs-cls/transactional';
import { TransactionalAdapterPrisma } from '@nestjs-cls/transactional-adapter-prisma';
import { BadRequestException, Injectable } from '@nestjs/common';

import { randomUUIDv7 } from 'node:crypto';
import { PlaceOrderCommand } from '~/api/order/application/place-order.command';
import { Order } from '~/api/order/domain/order';
import { OrderLine } from '~/api/order/domain/order-line';
import { toOrderCreateData } from '~/api/order/infrastructure/order.persistence';
import {
    orderableSnapshotItemSelect,
    orderableSnapshotItemWhere,
    toOrderLine,
} from '~/api/order/infrastructure/orderable-snapshot-item';
import { ItemStockShortage, NotExistingItem } from '~/global/common/error/item.error';
import { JwtPayload } from '~/global/jwt/payload/jwt.payload';

@Injectable()
export class OrderV1Service {
    constructor(private readonly txHost: TransactionHost<TransactionalAdapterPrisma>) {}

    @Transactional<TransactionalAdapterPrisma>()
    async order(jwtPayload: JwtPayload, command: PlaceOrderCommand) {
        const { memberId } = jwtPayload;
        const { items: requestedItems } = command;

        const orderLines: OrderLine[] = [];

        for (const orderItem of requestedItems) {
            const { itemId, quantity } = orderItem;

            // 현재 발행 포인터에 연결된 판매 가능 버전만 주문 원천으로 사용한다.
            const snapshotItem = await this.txHost.tx.productSnapshotItem.findFirst({
                where: orderableSnapshotItemWhere(itemId),
                select: orderableSnapshotItemSelect,
            });
            if (!snapshotItem) throw new BadRequestException(new NotExistingItem());
            if (snapshotItem.item.stock < quantity) throw new BadRequestException(new ItemStockShortage());

            orderLines.push(toOrderLine(itemId, quantity, snapshotItem));

            // 조건부 차감으로 동시 주문에서도 stock이 음수가 되는 것을 막는다.
            const { count } = await this.txHost.tx.item.updateMany({
                where: {
                    id: itemId,
                    deletedAt: null,
                    stock: {
                        gte: quantity,
                    },
                },
                data: {
                    stock: {
                        decrement: quantity,
                    },
                },
            });
            if (count !== 1) throw new BadRequestException(new ItemStockShortage());
        }

        const order = Order.place({
            memberId,
            orderNumber: randomUUIDv7(),
            currencyCode: 'KRW',
            items: orderLines,
        });
        const persisted = await this.txHost.tx.order.create({
            data: toOrderCreateData(order),
            select: { id: true },
        });

        return { id: persisted.id };
    }
}
