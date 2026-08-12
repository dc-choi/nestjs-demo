import { Prisma } from 'prisma/generated/client/client';
import { ItemSaleStatus, ProductSnapshotStatus, ProductStatus } from 'prisma/generated/client/enums';

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

export interface OrderedItem {
    itemId: bigint;
    productSnapshotId: bigint;
    productName: string;
    itemName: string;
    itemSku: string;
    productDescription: string | null;
    productReturnPolicy: string | null;
    unitSupplyPrice: Prisma.Decimal;
    unitVat: Prisma.Decimal;
    unitTotalPrice: Prisma.Decimal;
    lineTotalPrice: Prisma.Decimal;
    quantity: number;
    isTaxFree: boolean;
    selectedOptions: Prisma.InputJsonArray;
}

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

export function toOrderedItem(itemId: bigint, quantity: number, source: OrderableSnapshotItem): OrderedItem {
    return {
        itemId,
        productSnapshotId: source.productSnapshotId,
        productName: source.snapshot.name,
        itemName: source.name,
        itemSku: source.itemSku,
        productDescription: source.snapshot.description,
        productReturnPolicy: source.snapshot.returnPolicy,
        unitSupplyPrice: source.supplyPrice,
        unitVat: source.vat,
        unitTotalPrice: source.totalPrice,
        lineTotalPrice: source.totalPrice.mul(quantity),
        quantity,
        isTaxFree: source.isTaxFree,
        selectedOptions: source.optionValues.map(({ option, value }) => ({
            optionCode: option.code,
            optionName: option.name,
            valueCode: value.code,
            valueName: value.name,
        })),
    };
}

export function toOrderItemCreate(item: OrderedItem): Prisma.OrderItemCreateWithoutOrderInput {
    const { itemId, productSnapshotId, lineTotalPrice, quantity, ...snapshot } = item;

    return {
        lineTotalPrice,
        quantity,
        item: {
            connect: {
                id: itemId,
            },
        },
        snapshot: {
            create: {
                ...snapshot,
                source: {
                    connect: {
                        productSnapshotId_itemId: {
                            productSnapshotId,
                            itemId,
                        },
                    },
                },
            },
        },
    };
}
