import { Processor, WorkerHost } from '@nestjs/bullmq';
import { BadRequestException, Inject } from '@nestjs/common';

import { REPOSITORY, Repository } from '../../../../../prisma/repository';

import { Job } from 'bullmq';
import { randomUUIDv7 } from 'node:crypto';
import { Prisma } from 'prisma/generated/client/client';
import {
    OrderedItem,
    orderableSnapshotItemSelect,
    orderableSnapshotItemWhere,
    toOrderItemCreate,
    toOrderedItem,
} from '~/api/order/domain/ordered-item';
import { OrderQueueRequest } from '~/api/v3/order/domain/message/order-queue.message';
import { ItemStockShortage, NotExistingItem } from '~/global/common/error/item.error';
import { QueueResponse, queueErrorHandler } from '~/global/common/message/queue.message';
import { ORDER_QUEUE } from '~/infra/queue/queue.symbol';

@Processor(ORDER_QUEUE)
export class OrderProcessor extends WorkerHost {
    constructor(@Inject(REPOSITORY) private readonly repository: Repository) {
        super();
    }

    async process(job: Job<OrderQueueRequest, QueueResponse, string>): Promise<QueueResponse> {
        const { jwt, payload } = job.data;

        const { memberId } = jwt;
        const { data: requestedData } = payload;

        const items: OrderedItem[] = [];
        let totalPrice = new Prisma.Decimal(0);

        try {
            const id = await this.repository.$transaction(async (tx) => {
                for (const orderItem of requestedData) {
                    const { itemId, quantity } = orderItem;

                    // queue 지연 중 상품이 바뀌었을 수 있으므로 처리 시점의 현재 발행본만 주문 원천으로 사용한다.
                    const snapshotItem = await tx.$primary().productSnapshotItem.findFirst({
                        where: orderableSnapshotItemWhere(itemId),
                        select: orderableSnapshotItemSelect,
                    });
                    if (!snapshotItem) throw new BadRequestException(new NotExistingItem());
                    if (snapshotItem.item.stock < quantity) {
                        throw new BadRequestException(new ItemStockShortage());
                    }

                    const orderedItem = toOrderedItem(itemId, quantity, snapshotItem);
                    totalPrice = totalPrice.add(orderedItem.lineTotalPrice);
                    items.push(orderedItem);

                    // 조건부 차감으로 동시에 실행되는 worker 사이에서도 stock이 음수가 되는 것을 막는다.
                    const { count } = await tx.item.updateMany({
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

            return {
                success: true,
                statusCode: 200,
                message: `${id}번 주문이 성공적으로 접수되었습니다. 총 ${totalPrice.toNumber()}원이 결제되었습니다.`,
            };
        } catch (error: unknown) {
            return queueErrorHandler(error);
        }
    }
}
