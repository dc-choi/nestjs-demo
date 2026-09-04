import { PrimaryKeyProp, type Rel } from '@mikro-orm/core';
import { Entity, Index, ManyToOne, Property, Unique } from '@mikro-orm/decorators/legacy';

import { CategoryEntity } from './category.entity';
import { ProductEntity } from './product.entity';

/**
 * live Product와 공유 Category를 연결하는 현재 분류 배치다.
 * 복합 PK로 중복 연결을 막고 상품별 unique sequence로 노출 순서 충돌을 막는다.
 */
@Entity({ tableName: 'product_categories' })
@Unique({ name: 'product_categories_product_id_sequence_key', properties: ['product', 'sequence'] })
@Index({ name: 'product_categories_category_id_sequence_idx', properties: ['category', 'sequence'] })
export class ProductCategoryEntity {
    [PrimaryKeyProp]?: ['product', 'category'];

    @ManyToOne({
        entity: () => ProductEntity,
        fieldName: 'product_id',
        primary: true,
        updateRule: 'cascade',
        deleteRule: 'restrict',
        foreignKeyName: 'product_categories_product_id_fkey',
        unsigned: false,
        index: false,
    })
    product!: Rel<ProductEntity>;

    @ManyToOne({
        entity: () => CategoryEntity,
        fieldName: 'category_id',
        primary: true,
        updateRule: 'cascade',
        deleteRule: 'restrict',
        foreignKeyName: 'product_categories_category_id_fkey',
        unsigned: false,
        index: false,
    })
    category!: Rel<CategoryEntity>;

    @Property({ fieldName: 'sequence', type: 'integer', unsigned: true })
    sequence!: number;
}
