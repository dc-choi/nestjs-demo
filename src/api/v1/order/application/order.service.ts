import { TransactionHost, Transactional } from '@nestjs-cls/transactional';
import { TransactionalAdapterPrisma } from '@nestjs-cls/transactional-adapter-prisma';
import { BadRequestException, Injectable } from '@nestjs/common';

import { randomUUIDv7 } from 'node:crypto';
import { Prisma } from 'prisma/generated/client/client';
import {
    OrderedItem,
    orderableSnapshotItemSelect,
    orderableSnapshotItemWhere,
    toOrderItemCreate,
    toOrderedItem,
} from '~/api/order/domain/ordered-item';
import { OrderRequestDto, OrderResponseDto } from '~/api/v1/order/domain/dto/order.dto';
import { ItemStockShortage, NotExistingItem } from '~/global/common/error/item.error';
import { JwtPayload } from '~/global/jwt/payload/jwt.payload';

@Injectable()
export class OrderService {
    constructor(private readonly txHost: TransactionHost<TransactionalAdapterPrisma>) {}

    @Transactional<TransactionalAdapterPrisma>()
    async order(jwtPayload: JwtPayload, orderRequestDto: OrderRequestDto) {
        const { memberId } = jwtPayload;
        const { data: requestedData } = orderRequestDto;

        const items: OrderedItem[] = [];
        let totalPrice = new Prisma.Decimal(0);

        for (const orderItem of requestedData) {
            const { itemId, quantity } = orderItem;

            // 현재 발행 포인터에 연결된 판매 가능 버전만 주문 원천으로 사용한다.
            const snapshotItem = await this.txHost.tx.productSnapshotItem.findFirst({
                where: orderableSnapshotItemWhere(itemId),
                select: orderableSnapshotItemSelect,
            });
            if (!snapshotItem) throw new BadRequestException(new NotExistingItem());
            if (snapshotItem.item.stock < quantity) throw new BadRequestException(new ItemStockShortage());

            const orderedItem = toOrderedItem(itemId, quantity, snapshotItem);
            totalPrice = totalPrice.add(orderedItem.lineTotalPrice);
            items.push(orderedItem);

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

        const order = await this.txHost.tx.order.create({
            data: {
                orderNumber: randomUUIDv7(),
                totalPrice,
                memberId,
                OrderItem: {
                    create: items.map(toOrderItemCreate),
                },
            },
        });

        return new OrderResponseDto(order.id);
    }
}
