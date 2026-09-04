import type { Opt, Rel } from '@mikro-orm/core';
import { Entity, Enum, Index, ManyToOne, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy';

import { ItemEntity } from '~/api/catalog/domain/entity/item.entity';
import { InventoryMovementType } from '~/api/inventory/domain/inventory.enum';
import { isMysqlSignedInt, isNonNegativeMysqlSignedInt } from '~/global/common/utils/mysql-number';

/**
 * `ItemEntity.stock` 변경 근거와 변경 직후 잔액을 보존하는 추가 전용 원장이다.
 * 현재 재고의 권위는 Item에 두고, 재고 갱신과 원장 추가는 한 트랜잭션에서 처리한다.
 * 생성된 원장은 수정하거나 삭제하지 않는다.
 */
@Entity({ tableName: 'inventory_movements' })
@Unique({
    name: 'inventory_movements_item_id_idempotency_key_key',
    properties: ['item', 'idempotencyKey'],
})
@Index({ name: 'inventory_movements_item_id_created_at_idx', properties: ['item', 'createdAt'] })
@Index({ name: 'inventory_movements_item_sku_created_at_idx', properties: ['itemSku', 'createdAt'] })
@Index({
    name: 'inventory_movements_reference_type_reference_id_idx',
    properties: ['referenceType', 'referenceId'],
})
export class InventoryMovementEntity {
    static record({
        item,
        type,
        quantityDelta,
        stockAfter,
        idempotencyKey,
        referenceType = null,
        referenceId = null,
        reason = null,
    }: {
        readonly item: Rel<ItemEntity>;
        readonly type: InventoryMovementType;
        readonly quantityDelta: number;
        readonly stockAfter: number;
        readonly idempotencyKey: string;
        readonly referenceType?: string | null;
        readonly referenceId?: string | null;
        readonly reason?: string | null;
    }): InventoryMovementEntity {
        if (!isMysqlSignedInt(quantityDelta) || quantityDelta === 0) {
            throw new RangeError('재고 변경 수량은 -2147483648 이상 2147483647 이하의 0이 아닌 정수여야 합니다.');
        }
        if (!isNonNegativeMysqlSignedInt(stockAfter)) {
            throw new RangeError('변경 후 재고는 0 이상 2147483647 이하의 정수여야 합니다.');
        }
        if (idempotencyKey.trim().length === 0 || idempotencyKey.length > 128) {
            throw new RangeError('재고 멱등성 키는 1자 이상 128자 이하여야 합니다.');
        }
        if ((referenceType == null) !== (referenceId == null)) {
            throw new Error('재고 원장 참조 유형과 ID는 함께 지정해야 합니다.');
        }

        const movement = new InventoryMovementEntity();
        movement.item = item;
        movement.itemSku = item.sku;
        movement.type = type;
        movement.quantityDelta = quantityDelta;
        movement.stockAfter = stockAfter;
        movement.idempotencyKey = idempotencyKey;
        movement.referenceType = referenceType;
        movement.referenceId = referenceId;
        movement.reason = reason;

        return movement;
    }

    @PrimaryKey({ type: 'bigint', autoincrement: true, unsigned: false })
    id!: bigint;

    @Enum({ items: () => InventoryMovementType })
    type!: InventoryMovementType;

    /** 양수는 입고, 음수는 차감이며 0인 변경은 기록하지 않는다. */
    @Property({ fieldName: 'quantity_delta', columnType: 'int' })
    quantityDelta!: number;

    /** 같은 트랜잭션에서 변경을 반영한 뒤의 `ItemEntity.stock`과 일치해야 한다. */
    @Property({ fieldName: 'stock_after', columnType: 'int' })
    stockAfter!: number;

    /** 원장 생성 시 복사한 SKU이며 이후 Item 변경을 따라가지 않는다. */
    @Property({ fieldName: 'item_sku', columnType: 'varchar(255)' })
    itemSku!: string;

    /** 같은 Item 범위에서 재실행을 중복 원장으로 남기지 않게 하는 키다. */
    @Property({ fieldName: 'idempotency_key', columnType: 'varchar(128)' })
    idempotencyKey!: string;

    /** 외부 업무 객체를 느슨하게 가리키며 `referenceId`와의 동시 유무는 쓰기 경로가 보장한다. */
    @Property({ fieldName: 'reference_type', columnType: 'varchar(64)', nullable: true })
    referenceType: string | null = null;

    @Property({ fieldName: 'reference_id', columnType: 'varchar(128)', nullable: true })
    referenceId: string | null = null;

    @Property({ columnType: 'varchar(255)', nullable: true })
    reason: string | null = null;

    @Property({ fieldName: 'created_at', columnType: 'datetime(3)', defaultRaw: 'CURRENT_TIMESTAMP(3)' })
    createdAt!: Date & Opt;

    @ManyToOne(() => ItemEntity, {
        joinColumn: 'item_id',
        inversedBy: 'inventoryMovements',
        deleteRule: 'restrict',
        updateRule: 'cascade',
        foreignKeyName: 'inventory_movements_item_id_fkey',
        unsigned: false,
        index: false,
    })
    item!: Rel<ItemEntity>;
}
