import { Order } from '~/api/order/domain/order';
import { OrderLineSnapshot } from '~/api/order/domain/order-line';

export const ORDER_REPOSITORY = Symbol('ORDER_REPOSITORY');

export interface OrderableItem {
    readonly stock: number;
    readonly snapshot: OrderLineSnapshot;
}

export interface OrderTransaction {
    findOrderableItem(itemId: bigint): Promise<OrderableItem | null>;
    decrementStock(itemId: bigint, quantity: number): Promise<boolean>;
    save(order: Order): Promise<Order>;
}

export interface OrderRepository {
    transaction<T>(work: (transaction: OrderTransaction) => Promise<T>): Promise<T>;
}
