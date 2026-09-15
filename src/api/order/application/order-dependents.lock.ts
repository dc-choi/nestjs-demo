import { EntityManager, LockMode } from '@mikro-orm/core';

import type { OrderEntity } from '~/api/order/domain/entity/order.entity';
import { compareBigInt } from '~/global/common/utils/bigint';

/**
 * Locks everything a cancellation-style use case mutates under an order, in the one fixed order every
 * such use case must share to stay deadlock-free: payment attempts, then items, then inventory
 * reservations, then fulfillments, each by ascending ID. Items are refreshed under the lock so stock
 * arithmetic starts from committed values.
 *
 * The caller must already hold the order row lock inside an active transaction and must have populated
 * `items.item`, `items.inventoryReservation`, `paymentAttempts` and `fulfillments`.
 */
export async function lockOrderDependents(em: EntityManager, order: OrderEntity): Promise<void> {
    const attempts = order.paymentAttempts.getItems().toSorted(compareById);
    for (const attempt of attempts) await em.lock(attempt, LockMode.PESSIMISTIC_WRITE);

    const items = [...new Map(order.items.getItems().map(({ item }) => [item.id, item] as const)).values()].toSorted(
        compareById
    );
    for (const item of items) {
        await em.refresh(item, { connectionType: 'write', lockMode: LockMode.PESSIMISTIC_WRITE });
    }

    const reservations = order.inventoryReservations().toSorted(compareById);
    for (const reservation of reservations) await em.lock(reservation, LockMode.PESSIMISTIC_WRITE);

    const fulfillments = order.fulfillments.getItems().toSorted(compareById);
    for (const fulfillment of fulfillments) await em.lock(fulfillment, LockMode.PESSIMISTIC_WRITE);
}

function compareById(left: { readonly id: bigint }, right: { readonly id: bigint }): number {
    return compareBigInt(left.id, right.id);
}
