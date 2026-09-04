import type { Rel } from '@mikro-orm/core';
import { Entity, Index, ManyToOne, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy';

import { ItemEntity } from './item.entity';
import { ProductOptionValueEntity } from './product-option-value.entity';
import { ProductOptionEntity } from './product-option.entity';

/**
 * live Item이 각 ProductOption에서 선택한 값을 연결하는 현재 상태 모델이다.
 * Item, option, value는 각각 단일 FK로 안정적으로 로드하고 Product 소속은 Catalog writer가 검증한다.
 * unique(Item, option)는 Item이 같은 option에서 둘 이상의 값을 선택하지 못하게 한다.
 */
@Entity({ tableName: 'item_option_values' })
@Index({ name: 'item_option_values_item_id_product_id_idx', properties: ['item', 'productId'] })
@Index({ name: 'item_option_values_option_idx', properties: ['option'] })
@Index({ name: 'item_option_values_value_idx', properties: ['value'] })
@Unique({ name: 'item_option_values_item_id_product_option_id_key', properties: ['item', 'option'] })
export class ItemOptionValueEntity {
    @PrimaryKey({ fieldName: 'id', columnType: 'bigint', autoincrement: true, unsigned: false })
    id!: bigint;

    @Property({ fieldName: 'product_id', columnType: 'bigint', unsigned: false })
    productId!: bigint;

    @ManyToOne({
        entity: () => ItemEntity,
        fieldName: 'item_id',
        updateRule: 'cascade',
        deleteRule: 'restrict',
        foreignKeyName: 'item_option_values_item_id_fkey',
        unsigned: false,
        index: false,
    })
    item!: Rel<ItemEntity>;

    @ManyToOne({
        entity: () => ProductOptionEntity,
        fieldName: 'product_option_id',
        updateRule: 'cascade',
        deleteRule: 'restrict',
        foreignKeyName: 'item_option_values_product_option_id_fkey',
        unsigned: false,
        index: false,
    })
    option!: Rel<ProductOptionEntity>;

    @ManyToOne({
        entity: () => ProductOptionValueEntity,
        fieldName: 'product_option_value_id',
        updateRule: 'cascade',
        deleteRule: 'restrict',
        foreignKeyName: 'item_option_values_value_id_fkey',
        unsigned: false,
        index: false,
    })
    value!: Rel<ProductOptionValueEntity>;
}
