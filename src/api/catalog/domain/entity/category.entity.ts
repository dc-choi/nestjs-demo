import { Collection, type Opt, type Rel } from '@mikro-orm/core';
import { Entity, Index, ManyToOne, OneToMany, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy';

import { ProductCategoryEntity } from './product-category.entity';

/**
 * 여러 상품이 공유하는 현재 카탈로그의 자기 참조 분류 노드다.
 * 부모 관계로 계층을 만들고 활성 상태와 soft delete로 노출 생명주기를 관리한다.
 */
@Entity({ tableName: 'categories' })
@Unique({ name: 'categories_parent_id_name_key', properties: ['parent', 'name'] })
@Index({ name: 'categories_parent_id_is_active_sequence_idx', properties: ['parent', 'isActive', 'sequence'] })
export class CategoryEntity {
    @PrimaryKey({ fieldName: 'id', columnType: 'bigint', autoincrement: true, unsigned: false })
    id!: bigint;

    @Property({ fieldName: 'name', columnType: 'varchar(255)' })
    name!: string;

    /** 이름과 별개로 카테고리 경로와 외부 참조에서 사용하는 전역 고유 식별자다. */
    @Property({ fieldName: 'slug', columnType: 'varchar(255)', unique: 'categories_slug_key' })
    slug!: string;

    @Property({ fieldName: 'sequence', type: 'integer', unsigned: true, default: 0 })
    sequence: number & Opt = 0;

    @Property({ fieldName: 'is_active', columnType: 'tinyint(1)', default: true })
    isActive: boolean & Opt = true;

    @Property({ fieldName: 'created_at', type: 'datetime', length: 3, defaultRaw: 'CURRENT_TIMESTAMP(3)' })
    createdAt!: Date & Opt;

    @Property({
        fieldName: 'updated_at',
        type: 'datetime',
        length: 3,
        defaultRaw: 'CURRENT_TIMESTAMP(3)',
        onUpdate: () => new Date(),
    })
    updatedAt!: Date & Opt;

    @Property({ fieldName: 'deleted_at', type: 'datetime', length: 3, nullable: true })
    deletedAt!: Date | null;

    @ManyToOne({
        entity: () => CategoryEntity,
        fieldName: 'parent_id',
        updateRule: 'cascade',
        deleteRule: 'restrict',
        foreignKeyName: 'categories_parent_id_fkey',
        nullable: true,
        unsigned: false,
        index: false,
    })
    parent!: Rel<CategoryEntity> | null;

    @OneToMany({ entity: () => CategoryEntity, mappedBy: 'parent' })
    children = new Collection<CategoryEntity>(this);

    @OneToMany({ entity: () => ProductCategoryEntity, mappedBy: 'category' })
    products = new Collection<ProductCategoryEntity>(this);
}
