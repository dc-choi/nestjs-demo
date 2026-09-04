import { PrimaryKeyProp, type Rel } from '@mikro-orm/core';
import { Entity, Index, ManyToOne, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy';

import { ProductEntity } from './product.entity';

/**
 * live Product에 분류와 별개의 현재 태그 및 노출 순서를 부여하는 연결 모델이다.
 * 복합 PK와 상품별 unique sequence로 중복 태그와 순서 충돌을 막는다.
 */
@Entity({ tableName: 'product_tags' })
@Unique({ name: 'product_tags_product_id_sequence_key', properties: ['product', 'sequence'] })
@Index({ name: 'product_tags_value_idx', properties: ['value'] })
export class ProductTagEntity {
    [PrimaryKeyProp]?: ['product', 'value'];

    @ManyToOne({
        entity: () => ProductEntity,
        fieldName: 'product_id',
        primary: true,
        updateRule: 'cascade',
        deleteRule: 'restrict',
        foreignKeyName: 'product_tags_product_id_fkey',
        unsigned: false,
        index: false,
    })
    product!: Rel<ProductEntity>;

    @PrimaryKey({ fieldName: 'value', columnType: 'varchar(64)' })
    value!: string;

    @Property({ fieldName: 'sequence', type: 'integer', unsigned: true })
    sequence!: number;
}
