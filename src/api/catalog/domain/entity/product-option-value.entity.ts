import { Collection, type Rel } from '@mikro-orm/core';
import { Entity, ManyToOne, OneToMany, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy';

import { ItemOptionValueEntity } from './item-option-value.entity';
import { ProductOptionEntity } from './product-option.entity';

/**
 * 한 ProductOption에서 Item이 선택할 수 있는 현재 값이다.
 * option 안에서 code, name, sequence 중복을 막고, Item 선택의 소속 일치는 Catalog writer가 검증한다.
 */
@Entity({ tableName: 'product_option_values' })
@Unique({ name: 'product_option_values_option_id_code_key', properties: ['option', 'code'] })
@Unique({ name: 'product_option_values_option_id_name_key', properties: ['option', 'name'] })
@Unique({ name: 'product_option_values_option_id_sequence_key', properties: ['option', 'sequence'] })
export class ProductOptionValueEntity {
    @PrimaryKey({ fieldName: 'id', columnType: 'bigint', autoincrement: true, unsigned: false })
    id!: bigint;

    @Property({ fieldName: 'code', columnType: 'varchar(64)' })
    code!: string;

    @Property({ fieldName: 'name', columnType: 'varchar(255)' })
    name!: string;

    @Property({ fieldName: 'sequence', type: 'integer', unsigned: true })
    sequence!: number;

    @ManyToOne({
        entity: () => ProductOptionEntity,
        fieldName: 'product_option_id',
        updateRule: 'cascade',
        deleteRule: 'restrict',
        foreignKeyName: 'product_option_values_product_option_id_fkey',
        unsigned: false,
        index: false,
    })
    option!: Rel<ProductOptionEntity>;

    @OneToMany({ entity: () => ItemOptionValueEntity, mappedBy: 'value' })
    selections = new Collection<ItemOptionValueEntity>(this);
}
