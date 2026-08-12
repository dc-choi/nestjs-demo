import { BadRequestException, Inject, Injectable } from '@nestjs/common';

import { randomUUIDv7 } from 'node:crypto';
import { REPOSITORY, Repository } from 'prisma/repository';
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
export class OrderV2Service {
    constructor(@Inject(REPOSITORY) private readonly repository: Repository) {}

    async order(jwtPayload: JwtPayload, command: PlaceOrderCommand) {
        const { memberId } = jwtPayload;
        const { items: requestedItems } = command;

        const orderLines: OrderLine[] = [];

        const id = await this.repository.$transaction(async (tx) => {
            for (const orderItem of requestedItems) {
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

                orderLines.push(toOrderLine(itemId, quantity, snapshotItem));

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

            const order = Order.place({
                memberId,
                orderNumber: randomUUIDv7(),
                currencyCode: 'KRW',
                items: orderLines,
            });
            const { id } = await tx.order.create({
                data: toOrderCreateData(order),
                select: { id: true },
            });

            return id;
        });

        return { id };
    }
}
