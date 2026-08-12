import { Prisma } from 'prisma/generated/client/client';
import { ItemSaleStatus, ProductSnapshotStatus, ProductStatus } from 'prisma/generated/client/enums';
import { OrderableItem } from '~/api/order/application/order.repository';
import { OrderLine, OrderLineSnapshot } from '~/api/order/domain/order-line';

export const orderableSnapshotItemSelect = {
    productSnapshotId: true,
    name: true,
    itemSku: true,
    supplyPrice: true,
    vat: true,
    totalPrice: true,
    isTaxFree: true,
    item: {
        select: {
            stock: true,
        },
    },
    snapshot: {
        select: {
            name: true,
            description: true,
            returnPolicy: true,
        },
    },
    optionValues: {
        orderBy: {
            option: {
                sequence: 'asc',
            },
        },
        select: {
            option: {
                select: {
                    code: true,
                    name: true,
                },
            },
            value: {
                select: {
                    code: true,
                    name: true,
                },
            },
        },
    },
} as const satisfies Prisma.ProductSnapshotItemSelect;

type OrderableSnapshotItem = Prisma.ProductSnapshotItemGetPayload<{
    select: typeof orderableSnapshotItemSelect;
}>;

export function orderableSnapshotItemWhere(itemId: bigint): Prisma.ProductSnapshotItemWhereInput {
    return {
        itemId,
        itemSaleStatus: ItemSaleStatus.ALLOW,
        item: {
            deletedAt: null,
        },
        snapshot: {
            status: ProductSnapshotStatus.PUBLISHED,
            publication: {
                isNot: null,
            },
            product: {
                status: ProductStatus.ACTIVE,
                deletedAt: null,
            },
        },
    };
}

export function toOrderLine(itemId: bigint, quantity: number, source: OrderableSnapshotItem): OrderLine {
    return OrderLine.create({ itemId, quantity, snapshot: toOrderLineSnapshot(source) });
}

export function toOrderableItem(source: OrderableSnapshotItem): OrderableItem {
    return { stock: source.item.stock, snapshot: toOrderLineSnapshot(source) };
}

function toOrderLineSnapshot(source: OrderableSnapshotItem): OrderLineSnapshot {
    return {
        productSnapshotId: source.productSnapshotId,
        productName: source.snapshot.name,
        itemName: source.name,
        itemSku: source.itemSku,
        productDescription: source.snapshot.description,
        productReturnPolicy: source.snapshot.returnPolicy,
        unitSupplyPrice: source.supplyPrice.toString(),
        unitVat: source.vat.toString(),
        unitTotalPrice: source.totalPrice.toString(),
        isTaxFree: source.isTaxFree,
        selectedOptions: source.optionValues.map(({ option, value }) => ({
            optionCode: option.code,
            optionName: option.name,
            valueCode: value.code,
            valueName: value.name,
        })),
    };
}
