import { Collection, type Opt, type Rel } from '@mikro-orm/core';
import { Entity, Enum, Index, ManyToOne, OneToMany, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy';

import { ItemOptionValueEntity } from './item-option-value.entity';
import { ItemSaleStatus } from './item-sale-status';
import { ProductEntity } from './product.entity';

import { randomUUIDv7 } from 'node:crypto';
import { InventoryMovementEntity } from '~/api/inventory/domain/inventory-movement.entity';
import { OrderItemEntity } from '~/api/order/domain/entity/order-item.entity';

/**
 * Product 아래의 실제 판매 단위로 현재 가격, 세금, 판매 가능 상태와 재고를 보유한다.
 * 일반 상품 조회와 주문은 감사 Snapshot이 아니라 이 live 상태를 권위 원본으로 사용한다.
 */
@Entity({ tableName: 'items' })
@Unique({ name: 'items_product_id_sequence_key', properties: ['product', 'sequence'] })
@Unique({ name: 'items_product_id_option_signature_key', properties: ['product', 'optionSignature'] })
@Index({ name: 'items_product_id_deleted_at_idx', properties: ['product', 'deletedAt'] })
export class ItemEntity {
    @PrimaryKey({ fieldName: 'id', columnType: 'bigint', autoincrement: true, unsigned: false })
    id!: bigint;

    @Property({
        fieldName: 'sku',
        columnType: 'varchar(255)',
        unique: 'items_sku_key',
        onCreate: () => randomUUIDv7(),
    })
    sku!: string & Opt;

    @Property({ fieldName: 'name', columnType: 'varchar(255)' })
    name!: string;

    @Property({ fieldName: 'supply_price', columnType: 'decimal(10,3)', precision: 10, scale: 3 })
    supplyPrice!: string;

    @Property({ fieldName: 'vat', columnType: 'decimal(10,3)', precision: 10, scale: 3 })
    vat!: string;

    @Property({ fieldName: 'total_price', columnType: 'decimal(10,3)', precision: 10, scale: 3 })
    totalPrice!: string;

    @Property({ fieldName: 'is_tax_free', columnType: 'tinyint(1)', default: false })
    isTaxFree: boolean & Opt = false;

    /** Product가 ACTIVE여도 이 값이 ALLOW인 Item만 조회와 주문 대상으로 삼는다. */
    @Enum({ fieldName: 'sale_status', items: () => ItemSaleStatus, default: ItemSaleStatus.DENY })
    saleStatus: ItemSaleStatus & Opt = ItemSaleStatus.DENY;

    /** 현재 재고의 권위 값이며 감사 Snapshot에는 복사하지 않는다. 변경 근거는 InventoryMovement에 남긴다. */
    @Property({ fieldName: 'stock', columnType: 'int', default: 0 })
    stock: number & Opt = 0;

    @Property({ fieldName: 'sequence', type: 'integer', unsigned: true })
    sequence!: number;

    /** 선택 옵션 조합을 정규화한 서명으로, 같은 Product 안의 중복 SKU 조합을 막는다. */
    @Property({ fieldName: 'option_signature', columnType: 'char(64)' })
    optionSignature!: string;

    @Property({ fieldName: 'created_at', columnType: 'datetime', defaultRaw: 'CURRENT_TIMESTAMP' })
    createdAt!: Date & Opt;

    @Property({
        fieldName: 'updated_at',
        columnType: 'datetime',
        defaultRaw: 'CURRENT_TIMESTAMP',
        onUpdate: () => new Date(),
    })
    updatedAt!: Date & Opt;

    @Property({ fieldName: 'deleted_at', columnType: 'datetime', nullable: true })
    deletedAt: Date | null = null;

    @ManyToOne({
        entity: () => ProductEntity,
        fieldName: 'product_id',
        updateRule: 'cascade',
        deleteRule: 'restrict',
        foreignKeyName: 'items_product_id_fkey',
        unsigned: false,
        index: false,
    })
    product!: Rel<ProductEntity>;

    @OneToMany({ entity: () => ItemOptionValueEntity, mappedBy: 'item' })
    optionValues = new Collection<ItemOptionValueEntity>(this);

    @OneToMany({ entity: () => OrderItemEntity, mappedBy: 'item' })
    orderItems = new Collection<OrderItemEntity>(this);

    @OneToMany({ entity: () => InventoryMovementEntity, mappedBy: 'item' })
    inventoryMovements = new Collection<InventoryMovementEntity>(this);
}
