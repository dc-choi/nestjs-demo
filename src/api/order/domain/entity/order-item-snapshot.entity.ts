import type { Opt, Rel } from '@mikro-orm/core';
import { Entity, Index, OneToOne, Property } from '@mikro-orm/decorators/legacy';

import { ItemEntity } from '~/api/catalog/domain/entity/item.entity';
import { SelectedOrderOptionSnapshot } from '~/api/order/domain/entity/order-item-snapshot.type';
import { OrderItemEntity } from '~/api/order/domain/entity/order-item.entity';

/**
 * 주문 접수 시 live Product와 Item의 표시 정보와 실제 적용 단가를 고정한 거래 증거다.
 * 영수증, 환불, 주문 조회는 변경 가능한 Catalog를 다시 조합하지 않고 이 값을 사용한다.
 * source 식별자와 revision은 추적용 scalar이며 Catalog 또는 ProductSnapshot FK가 아니다.
 */
@Entity({ tableName: 'order_item_snapshots' })
@Index({
    name: 'order_item_snapshots_source_product_item_revision_idx',
    properties: ['sourceProductId', 'sourceItemId', 'sourceProductRevision'],
})
export class OrderItemSnapshotEntity {
    static capture(orderItem: OrderItemEntity, item: ItemEntity): OrderItemSnapshotEntity {
        const { product } = item;
        const snapshot = new OrderItemSnapshotEntity();
        snapshot.orderItem = orderItem;
        snapshot.productName = product.name;
        snapshot.itemName = item.name;
        snapshot.itemSku = item.sku;
        snapshot.productDescription = product.description;
        snapshot.productReturnPolicy = product.returnPolicy;
        snapshot.unitSupplyPrice = item.supplyPrice;
        snapshot.unitVat = item.vat;
        snapshot.unitTotalPrice = item.totalPrice;
        snapshot.isTaxFree = item.isTaxFree;
        snapshot.selectedOptions = [...item.optionValues.getItems()]
            .sort((left, right) => left.option.sequence - right.option.sequence)
            .map(({ option, value }) => ({
                optionCode: option.code,
                optionName: option.name,
                valueCode: value.code,
                valueName: value.name,
            }));
        snapshot.sourceProductId = product.id;
        snapshot.sourceItemId = item.id;
        snapshot.sourceProductRevision = product.revision;

        return snapshot;
    }

    @OneToOne(() => OrderItemEntity, (orderItem) => orderItem.snapshot, {
        primary: true,
        owner: true,
        joinColumn: 'order_item_id',
        deleteRule: 'restrict',
        updateRule: 'cascade',
        foreignKeyName: 'order_item_snapshots_order_item_id_fkey',
        unsigned: false,
        index: false,
    })
    orderItem!: Rel<OrderItemEntity>;

    @Property({ fieldName: 'product_name', columnType: 'varchar(255)' })
    productName!: string;

    @Property({ fieldName: 'item_name', columnType: 'varchar(255)' })
    itemName!: string;

    @Property({ fieldName: 'item_sku', columnType: 'varchar(255)' })
    itemSku!: string;

    @Property({ fieldName: 'product_description', columnType: 'longtext', nullable: true })
    productDescription: string | null = null;

    @Property({ fieldName: 'product_return_policy', columnType: 'text', nullable: true })
    productReturnPolicy: string | null = null;

    @Property({ fieldName: 'unit_supply_price', type: 'decimal', precision: 10, scale: 3 })
    unitSupplyPrice!: string;

    @Property({ fieldName: 'unit_vat', type: 'decimal', precision: 10, scale: 3 })
    unitVat!: string;

    /** `OrderItemEntity.lineTotalPrice` 계산에 사용한 주문 시점 단가다. */
    @Property({ fieldName: 'unit_total_price', type: 'decimal', precision: 10, scale: 3 })
    unitTotalPrice!: string;

    @Property({ fieldName: 'is_tax_free', columnType: 'tinyint(1)', default: false })
    isTaxFree: boolean & Opt = false;

    /** 옵션과 값의 코드 및 표시명을 `option.sequence` 순서로 보존한다. */
    @Property({ fieldName: 'selected_options', type: 'json' })
    selectedOptions!: SelectedOrderOptionSnapshot[];

    /** 캡처한 live Product ID이며 Product 관계를 만들지 않는다. */
    @Property({ fieldName: 'source_product_id', columnType: 'bigint', unsigned: false })
    sourceProductId!: bigint;

    /** 캡처한 live Item ID이며 Item 관계를 만들지 않는다. */
    @Property({ fieldName: 'source_item_id', columnType: 'bigint', unsigned: false })
    sourceItemId!: bigint;

    /** 캡처한 live Product revision이며 ProductSnapshot 관계를 만들지 않는다. */
    @Property({ fieldName: 'source_product_revision', type: 'integer' })
    sourceProductRevision!: number;

    @Property({ fieldName: 'created_at', columnType: 'datetime(3)', defaultRaw: 'CURRENT_TIMESTAMP(3)' })
    createdAt!: Date & Opt;
}
