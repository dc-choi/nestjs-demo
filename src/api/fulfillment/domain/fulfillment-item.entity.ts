import { Collection, type Rel } from '@mikro-orm/core';
import { Entity, Index, ManyToOne, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy';

import { FulfillmentEntity } from '~/api/fulfillment/domain/fulfillment.entity';
import { OrderItemEntity } from '~/api/order/domain/entity/order-item.entity';
import { isPositiveMysqlSignedInt } from '~/global/common/utils/mysql-number';

/**
 * 주문 품목 수량 중 한 배송에 배정된 몫이다.
 * 같은 주문 품목을 여러 Fulfillment로 나눠 부분 배송할 수 있다.
 * 복합 unique는 한 배송의 중복 행만 막고 주문 소속과 누적 수량은 쓰기 경로가 검증한다.
 */
@Entity({ tableName: 'fulfillment_items' })
@Unique({
    name: 'fulfillment_items_fulfillment_id_order_item_id_key',
    properties: ['fulfillment', 'orderItem'],
})
@Index({ name: 'fulfillment_items_order_item_id_idx', properties: ['orderItem'] })
export class FulfillmentItemEntity {
    static allocate(
        fulfillment: Rel<FulfillmentEntity>,
        orderItem: Rel<OrderItemEntity>,
        quantity: number
    ): FulfillmentItemEntity {
        if (!isPositiveMysqlSignedInt(quantity)) {
            throw new RangeError('배송 수량은 1 이상 2147483647 이하의 정수여야 합니다.');
        }

        const item = new FulfillmentItemEntity();
        item.fulfillment = fulfillment;
        item.orderItem = orderItem;
        item.quantity = quantity;
        fulfillment.items = new Collection(fulfillment, [...fulfillment.items.getItems(), item]);
        if (orderItem.fulfillmentItems.isInitialized()) {
            orderItem.fulfillmentItems = new Collection(orderItem, [...orderItem.fulfillmentItems.getItems(), item]);
        }

        return item;
    }

    @PrimaryKey({ type: 'bigint', autoincrement: true, unsigned: false })
    id!: bigint;

    /** 양수이며 취소되지 않은 배송의 누적 합이 `orderItem.quantity`를 넘지 않아야 한다. */
    @Property({ columnType: 'int' })
    quantity!: number;

    @ManyToOne(() => FulfillmentEntity, {
        joinColumn: 'fulfillment_id',
        inversedBy: 'items',
        deleteRule: 'restrict',
        updateRule: 'cascade',
        foreignKeyName: 'fulfillment_items_fulfillment_id_fkey',
        unsigned: false,
        index: false,
    })
    fulfillment!: Rel<FulfillmentEntity>;

    @ManyToOne(() => OrderItemEntity, {
        joinColumn: 'order_item_id',
        inversedBy: 'fulfillmentItems',
        deleteRule: 'restrict',
        updateRule: 'cascade',
        foreignKeyName: 'fulfillment_items_order_item_id_fkey',
        unsigned: false,
        index: false,
    })
    orderItem!: Rel<OrderItemEntity>;
}
