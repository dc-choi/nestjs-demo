import type { Prisma } from 'prisma/generated/client/client';

export interface OrderedItemInterface {
    itemId: bigint;
    quantity: number;
    itemPrice: Prisma.Decimal;
}
