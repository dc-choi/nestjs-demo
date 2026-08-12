import { Prisma } from 'prisma/generated/client/client';
import { Order } from '~/api/order/domain/order';
import { OrderLine } from '~/api/order/domain/order-line';

export const persistedOrderSelect = {
    id: true,
    status: true,
    createdAt: true,
    OrderItem: {
        orderBy: {
            id: 'asc',
        },
        select: {
            id: true,
            itemId: true,
        },
    },
} as const satisfies Prisma.OrderSelect;

type PersistedOrder = Prisma.OrderGetPayload<{
    select: typeof persistedOrderSelect;
}>;

export function toOrderCreateData(order: Order): Prisma.OrderCreateInput {
    return {
        orderNumber: order.orderNumber,
        status: order.status,
        currencyCode: order.currencyCode,
        totalPrice: new Prisma.Decimal(order.totalPrice),
        member: {
            connect: {
                id: order.memberId,
            },
        },
        OrderItem: {
            create: order.items.map(toOrderItemCreate),
        },
    };
}

export function toPersistedOrder(order: Order, persisted: PersistedOrder): Order {
    const itemIdsBySource = new Map<bigint, bigint[]>();

    for (const { id, itemId } of persisted.OrderItem) {
        const ids = itemIdsBySource.get(itemId) ?? [];
        ids.push(id);
        itemIdsBySource.set(itemId, ids);
    }

    return order.persisted({
        id: persisted.id,
        status: persisted.status,
        createdAt: persisted.createdAt,
        itemIds: order.items.map(({ itemId }) => {
            const id = itemIdsBySource.get(itemId)?.shift();
            if (id === undefined) throw new Error(`저장된 주문 품목 ${itemId}의 ID를 찾을 수 없습니다.`);

            return id;
        }),
    });
}

export function toOrderItemCreate(item: OrderLine): Prisma.OrderItemCreateWithoutOrderInput {
    const { snapshot } = item;
    const selectedOptions: Prisma.InputJsonArray = snapshot.selectedOptions.map((option) => ({ ...option }));

    return {
        lineTotalPrice: new Prisma.Decimal(item.lineTotalPrice),
        quantity: item.quantity,
        item: {
            connect: {
                id: item.itemId,
            },
        },
        snapshot: {
            create: {
                productName: snapshot.productName,
                itemName: snapshot.itemName,
                itemSku: snapshot.itemSku,
                productDescription: snapshot.productDescription,
                productReturnPolicy: snapshot.productReturnPolicy,
                unitSupplyPrice: new Prisma.Decimal(snapshot.unitSupplyPrice),
                unitVat: new Prisma.Decimal(snapshot.unitVat),
                unitTotalPrice: new Prisma.Decimal(snapshot.unitTotalPrice),
                isTaxFree: snapshot.isTaxFree,
                selectedOptions,
                source: {
                    connect: {
                        productSnapshotId_itemId: {
                            productSnapshotId: snapshot.productSnapshotId,
                            itemId: item.itemId,
                        },
                    },
                },
            },
        },
    };
}
