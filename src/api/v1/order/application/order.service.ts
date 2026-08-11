import { TransactionHost, Transactional } from '@nestjs-cls/transactional';
import { TransactionalAdapterPrisma } from '@nestjs-cls/transactional-adapter-prisma';
import { BadRequestException, Injectable, InternalServerErrorException } from '@nestjs/common';

import { randomUUIDv7 } from 'node:crypto';
import { Prisma } from 'prisma/generated/client/client';
import { OrderRequestDto, OrderResponseDto } from '~/api/v1/order/domain/dto/order.dto';
import { ItemStockShortage, NotExistingItem } from '~/global/common/error/item.error';
import { OrderServerError } from '~/global/common/error/order.error';
import { JwtPayload } from '~/global/jwt/payload/jwt.payload';

@Injectable()
export class OrderService {
    constructor(private readonly txHost: TransactionHost<TransactionalAdapterPrisma>) {}

    @Transactional<TransactionalAdapterPrisma>()
    async order(jwtPayload: JwtPayload, orderRequestDto: OrderRequestDto) {
        const { memberId } = jwtPayload;
        const { data: requestedData } = orderRequestDto;

        const items: { itemId: bigint; quantity: number; itemPrice: Prisma.Decimal }[] = [];
        let totalPrice = new Prisma.Decimal(0);

        await Promise.all(
            requestedData.map(async (orderItem) => {
                const { itemId, quantity } = orderItem;

                // 주문 요청한 상품의 존재 여부 확인, 재고 확인
                const item = await this.txHost.tx.item.findFirst({
                    where: {
                        id: itemId,
                    },
                });
                if (!item) throw new BadRequestException(new NotExistingItem());
                if (item.stock < quantity) throw new BadRequestException(new ItemStockShortage());

                // 주문 가격 계산
                const itemPrice = item.totalPrice.mul(quantity);
                totalPrice = totalPrice.add(itemPrice);
                items.push({ itemId, quantity, itemPrice });

                // 주문 요청한 상품의 재고 차감
                await this.txHost.tx.item.update({
                    where: {
                        id: itemId,
                    },
                    data: {
                        stock: {
                            decrement: quantity,
                        },
                    },
                });
            })
        );

        // 주문 생성
        const order = await this.txHost.tx.order.create({
            data: {
                orderNumber: randomUUIDv7(),
                totalPrice,
                memberId,
            },
        });
        const { count } = await this.txHost.tx.orderItem.createMany({
            data: items.map(({ itemId, quantity, itemPrice }) => ({
                orderId: order.id,
                itemId,
                quantity,
                price: itemPrice,
            })),
        });
        if (items.length !== count) throw new InternalServerErrorException(new OrderServerError());

        return new OrderResponseDto(order.id);
    }
}
