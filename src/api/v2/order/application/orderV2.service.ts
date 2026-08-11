import { BadRequestException, Inject, Injectable, InternalServerErrorException } from '@nestjs/common';

import { REPOSITORY, Repository } from '../../../../../prisma/repository';

import { randomUUIDv7 } from 'node:crypto';
import { type Item, Prisma } from 'prisma/generated/client/client';
import { OrderV2RequestDto, OrderV2ResponseDto } from '~/api/v2/order/domain/dto/orderV2.dto';
import { OrderedItemInterface } from '~/api/v2/order/domain/interface/orderedItem.interface';
import { ItemStockShortage, NotExistingItem } from '~/global/common/error/item.error';
import { OrderServerError } from '~/global/common/error/order.error';
import { JwtPayload } from '~/global/jwt/payload/jwt.payload';

@Injectable()
export class OrderV2Service {
    constructor(@Inject(REPOSITORY) private readonly repository: Repository) {}

    async order(jwtPayload: JwtPayload, orderV2RequestDto: OrderV2RequestDto) {
        const { memberId } = jwtPayload;
        const { data: requestedData } = orderV2RequestDto;

        const items: OrderedItemInterface[] = [];
        let totalPrice = new Prisma.Decimal(0);

        const id = await this.repository.$transaction(async (tx) => {
            for (const orderItem of requestedData) {
                const { itemId, quantity } = orderItem;

                // 재고 검증과 차감 사이를 직렬화하려면 같은 primary transaction에서 행 잠금을 유지해야 한다.
                // 여러 품목은 요청 순서대로 잠기므로 서로 다른 순서의 요청끼리는 교착이 발생할 수 있다.
                const item = await tx
                    .$primary()
                    .$kysely.selectFrom('items')
                    .selectAll()
                    .where('id', '=', Number(itemId))
                    .forUpdate()
                    .executeTakeFirstOrThrow()
                    .then((result) => {
                        const { id, memberId, totalPrice, supplyPrice } = result;

                        return {
                            ...result,
                            id: BigInt(id),
                            memberId: BigInt(memberId),
                            supplyPrice: new Prisma.Decimal(supplyPrice),
                            totalPrice: new Prisma.Decimal(totalPrice),
                        } as unknown as Item;
                    });

                if (!item) throw new BadRequestException(new NotExistingItem());
                const { stock, totalPrice: storedTotalPrice } = item;
                if (stock < quantity) throw new BadRequestException(new ItemStockShortage());

                // 주문 가격 계산
                const itemPrice = storedTotalPrice.mul(quantity);
                totalPrice = totalPrice.add(itemPrice);
                items.push({ itemId, quantity, itemPrice });

                await tx.item.update({
                    where: {
                        id: itemId,
                    },
                    data: {
                        stock: {
                            decrement: quantity,
                        },
                    },
                });
            }

            // 주문 생성
            const { id } = await tx.order.create({
                data: {
                    orderNumber: randomUUIDv7(),
                    totalPrice,
                    memberId,
                },
            });
            const { count } = await tx.orderItem.createMany({
                data: items.map(({ itemId, quantity, itemPrice }) => ({
                    orderId: id,
                    itemId,
                    quantity,
                    price: itemPrice,
                })),
            });
            if (items.length !== count) throw new InternalServerErrorException(new OrderServerError());

            return id;
        });

        return new OrderV2ResponseDto(id);
    }
}
