import { Collection, type Opt, type Rel } from '@mikro-orm/core';
import { Entity, ManyToOne, OneToMany, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy';

import { ItemOptionValueEntity } from './item-option-value.entity';
import { ProductOptionValueEntity } from './product-option-value.entity';
import { ProductEntity } from './product.entity';

/**
 * live Product의 SKU 조합을 정의하는 옵션 축이다.
 * Product 안에서 code, name, sequence 중복을 막고, Item 선택의 소속 일치는 Catalog writer가 검증한다.
 */
@Entity({ tableName: 'product_options' })
@Unique({ name: 'product_options_product_id_code_key', properties: ['product', 'code'] })
@Unique({ name: 'product_options_product_id_name_key', properties: ['product', 'name'] })
@Unique({ name: 'product_options_product_id_sequence_key', properties: ['product', 'sequence'] })
export class ProductOptionEntity {
    @PrimaryKey({ fieldName: 'id', columnType: 'bigint', autoincrement: true, unsigned: false })
    id!: bigint;

    @Property({ fieldName: 'code', columnType: 'varchar(64)' })
    code!: string;

    @Property({ fieldName: 'name', columnType: 'varchar(255)' })
    name!: string;

    @Property({ fieldName: 'is_required', columnType: 'tinyint(1)', default: true })
    isRequired: boolean & Opt = true;

    @Property({ fieldName: 'sequence', type: 'integer', unsigned: true })
    sequence!: number;

    @ManyToOne({
        entity: () => ProductEntity,
        fieldName: 'product_id',
        updateRule: 'cascade',
        deleteRule: 'restrict',
        foreignKeyName: 'product_options_product_id_fkey',
        unsigned: false,
        index: false,
    })
    product!: Rel<ProductEntity>;

    @OneToMany({ entity: () => ProductOptionValueEntity, mappedBy: 'option' })
    values = new Collection<ProductOptionValueEntity>(this);

    @OneToMany({ entity: () => ItemOptionValueEntity, mappedBy: 'option' })
    selections = new Collection<ItemOptionValueEntity>(this);
}
