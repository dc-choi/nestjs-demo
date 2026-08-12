import { Inject, Injectable } from '@nestjs/common';

import { REPOSITORY, Repository } from 'prisma/repository';
import { OrderRepository, OrderTransaction } from '~/api/order/application/order.repository';
import {
    persistedOrderSelect,
    toOrderCreateData,
    toPersistedOrder,
} from '~/api/order/infrastructure/order.persistence';
import {
    orderableSnapshotItemSelect,
    orderableSnapshotItemWhere,
    toOrderableItem,
} from '~/api/order/infrastructure/orderable-snapshot-item';

@Injectable()
export class PrismaOrderRepository implements OrderRepository {
    constructor(@Inject(REPOSITORY) private readonly repository: Repository) {}

    transaction<T>(work: (transaction: OrderTransaction) => Promise<T>): Promise<T> {
        return this.repository.$transaction((prisma) =>
            work({
                findOrderableItem: async (itemId) => {
                    const item = await prisma.$primary().productSnapshotItem.findFirst({
                        where: orderableSnapshotItemWhere(itemId),
                        select: orderableSnapshotItemSelect,
                    });

                    return item ? toOrderableItem(item) : null;
                },
                decrementStock: async (itemId, quantity) => {
                    const { count } = await prisma.item.updateMany({
                        where: {
                            id: itemId,
                            deletedAt: null,
                            stock: { gte: quantity },
                        },
                        data: {
                            stock: { decrement: quantity },
                        },
                    });

                    return count === 1;
                },
                save: async (order) => {
                    const persisted = await prisma.order.create({
                        data: toOrderCreateData(order),
                        select: persistedOrderSelect,
                    });

                    return toPersistedOrder(order, persisted);
                },
            })
        );
    }
}
