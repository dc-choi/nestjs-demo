import { Cascade, Collection, type Opt, type Rel } from '@mikro-orm/core';
import { Entity, Index, ManyToOne, OneToMany, OneToOne, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';

import { ItemEntity } from '~/api/catalog/domain/entity/item.entity';
import { FulfillmentItemEntity } from '~/api/fulfillment/domain/fulfillment-item.entity';
import { InventoryReservationEntity } from '~/api/inventory/domain/inventory-reservation.entity';
import { assertOrderMoneyFits, multiplyDecimal } from '~/api/order/domain/decimal';
import { OrderItemSnapshotEntity } from '~/api/order/domain/entity/order-item-snapshot.entity';
import { OrderEntity } from '~/api/order/domain/entity/order.entity';
import { isPositiveMysqlSignedInt } from '~/global/common/utils/mysql-number';

interface CreateOrderItem {
    readonly quantity: number;
    readonly item: ItemEntity;
}

/**
 * 주문 수량과 거래 합계를 보관하는 주문 aggregate의 품목 행이다.
 * 표시 정보와 단가는 별도 snapshot에 고정하고 두 행을 주문 생성 시 함께 저장한다.
 * 재고 예약은 최대 하나이며, 주문 수량은 여러 배송에 나눠 배정할 수 있다.
 */
@Entity({ tableName: 'order_items' })
@Index({ name: 'order_items_order_id_idx', properties: ['order'] })
@Index({ name: 'order_items_item_id_idx', properties: ['item'] })
export class OrderItemEntity {
    static create({ quantity, item }: CreateOrderItem): OrderItemEntity {
        if (!isPositiveMysqlSignedInt(quantity)) {
            throw new RangeError('수량은 1 이상 2147483647 이하의 정수여야 합니다.');
        }

        const lineTotalPrice = multiplyDecimal(item.totalPrice, quantity);
        assertOrderMoneyFits(lineTotalPrice);

        const orderItem = new OrderItemEntity();
        orderItem.lineTotalPrice = lineTotalPrice;
        orderItem.quantity = quantity;
        orderItem.item = item;
        orderItem.snapshot = OrderItemSnapshotEntity.capture(orderItem, item);

        return orderItem;
    }

    @PrimaryKey({ type: 'bigint', autoincrement: true, unsigned: false })
    id!: bigint;

    /** 주문 시점 `unitTotalPrice * quantity`이며 주문 총액 계산의 근거다. */
    @Property({ fieldName: 'price', type: 'decimal', precision: 19, scale: 3 })
    lineTotalPrice!: string;

    @Property({ columnType: 'int' })
    quantity!: number;

    @Property({ fieldName: 'created_at', columnType: 'datetime', defaultRaw: 'CURRENT_TIMESTAMP' })
    createdAt!: Date & Opt;

    @ManyToOne(() => ItemEntity, {
        joinColumn: 'item_id',
        inversedBy: 'orderItems',
        deleteRule: 'restrict',
        updateRule: 'cascade',
        foreignKeyName: 'order_items_item_id_fkey',
        unsigned: false,
        index: false,
    })
    item!: Rel<ItemEntity>;

    @ManyToOne(() => OrderEntity, {
        joinColumn: 'order_id',
        inversedBy: 'items',
        deleteRule: 'restrict',
        updateRule: 'cascade',
        foreignKeyName: 'order_items_order_id_fkey',
        unsigned: false,
        index: false,
    })
    order!: Rel<OrderEntity>;

    /** FK를 snapshot이 소유해 관계는 선택형이지만 `create` 경로에서는 항상 함께 만든다. */
    @OneToOne(() => OrderItemSnapshotEntity, (snapshot) => snapshot.orderItem, {
        cascade: [Cascade.PERSIST],
        nullable: true,
    })
    snapshot?: Rel<OrderItemSnapshotEntity>;

    @OneToOne(() => InventoryReservationEntity, (reservation) => reservation.orderItem, {
        nullable: true,
    })
    inventoryReservation?: Rel<InventoryReservationEntity>;

    @OneToMany(() => FulfillmentItemEntity, (fulfillmentItem) => fulfillmentItem.orderItem)
    fulfillmentItems = new Collection<FulfillmentItemEntity>(this);
}
