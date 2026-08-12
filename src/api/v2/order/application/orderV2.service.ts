import { BadRequestException, Inject, Injectable } from '@nestjs/common';

import { REPOSITORY, Repository } from '../../../../../prisma/repository';

import { randomUUIDv7 } from 'node:crypto';
import { Prisma } from 'prisma/generated/client/client';
import {
    OrderedItem,
    orderableSnapshotItemSelect,
    orderableSnapshotItemWhere,
    toOrderItemCreate,
    toOrderedItem,
} from '~/api/order/domain/ordered-item';
import { OrderV2RequestDto, OrderV2ResponseDto } from '~/api/v2/order/domain/dto/orderV2.dto';
import { ItemStockShortage, NotExistingItem } from '~/global/common/error/item.error';
import { JwtPayload } from '~/global/jwt/payload/jwt.payload';

@Injectable()
export class OrderV2Service {
    constructor(@Inject(REPOSITORY) private readonly repository: Repository) {}

    async order(jwtPayload: JwtPayload, orderV2RequestDto: OrderV2RequestDto) {
        const { memberId } = jwtPayload;
        const { data: requestedData } = orderV2RequestDto;

        const items: OrderedItem[] = [];
        let totalPrice = new Prisma.Decimal(0);

        const id = await this.repository.$transaction(async (tx) => {
            for (const orderItem of requestedData) {
                const { itemId, quantity } = orderItem;

                // 재고 검증과 차감 사이를 직렬화하려면 같은 primary transaction에서 행 잠금을 유지해야 한다.
                // 여러 품목은 요청 순서대로 잠기므로 서로 다른 순서의 요청끼리는 교착이 발생할 수 있다.
                const lockedItem = await tx
                    .$primary()
                    .$kysely.selectFrom('items as i')
                    .select(['i.stock'])
                    .where('i.id', '=', Number(itemId))
                    .where('i.deletedAt', 'is', null)
                    .forUpdate()
                    .executeTakeFirst();

                if (!lockedItem) throw new BadRequestException(new NotExistingItem());
                if (lockedItem.stock < quantity) throw new BadRequestException(new ItemStockShortage());

                // 잠근 Item의 현재 발행본을 Prisma로 읽어 카탈로그 원천과 주문 snapshot의 타입을 그대로 유지한다.
                const snapshotItem = await tx.productSnapshotItem.findFirst({
                    where: orderableSnapshotItemWhere(itemId),
                    select: orderableSnapshotItemSelect,
                });
                if (!snapshotItem) throw new BadRequestException(new NotExistingItem());

                const orderedItem = toOrderedItem(itemId, quantity, snapshotItem);
                totalPrice = totalPrice.add(orderedItem.lineTotalPrice);
                items.push(orderedItem);

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

            const { id } = await tx.order.create({
                data: {
                    orderNumber: randomUUIDv7(),
                    totalPrice,
                    memberId,
                    OrderItem: {
                        create: items.map(toOrderItemCreate),
                    },
                },
            });

            return id;
        });

        return new OrderV2ResponseDto(id);
    }
}
