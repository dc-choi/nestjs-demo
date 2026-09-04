import { Collection, type Opt, type Rel } from '@mikro-orm/core';
import { Entity, Enum, Index, ManyToOne, OneToMany, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';

import { ItemEntity } from './item.entity';
import { ProductCategoryEntity } from './product-category.entity';
import { ProductMediaEntity } from './product-media.entity';
import { ProductOptionEntity } from './product-option.entity';
import { ProductSnapshotEntity } from './product-snapshot.entity';
import { ProductStatus } from './product-status';
import { ProductTagEntity } from './product-tag.entity';

import { MemberEntity } from '~/api/member/domain/member.entity';

/**
 * 현재 판매 상태의 권위 원본인 Product aggregate root다.
 * Item, 옵션, 카테고리, 미디어와 태그 graph를 소유하며 감사 Snapshot은 이를 대체하지 않는다.
 */
@Entity({ tableName: 'products' })
@Index({ name: 'products_seller_id_status_idx', properties: ['seller', 'status'] })
@Index({ name: 'products_status_created_at_idx', properties: ['status', 'createdAt'] })
export class ProductEntity {
    @PrimaryKey({ fieldName: 'id', columnType: 'bigint', autoincrement: true, unsigned: false })
    id!: bigint;

    /** 이름 변경과 무관하게 URL과 외부 참조에서 상품을 식별하는 전역 고유 키다. */
    @Property({ fieldName: 'slug', columnType: 'varchar(255)', unique: 'products_slug_key' })
    slug!: string;

    @Property({ fieldName: 'name', columnType: 'varchar(255)' })
    name!: string;

    @Property({ fieldName: 'description', columnType: 'longtext', nullable: true })
    description: string | null = null;

    @Property({ fieldName: 'return_policy', columnType: 'text', nullable: true })
    returnPolicy: string | null = null;

    @Enum({ fieldName: 'status', items: () => ProductStatus, default: ProductStatus.DRAFT })
    status: ProductStatus & Opt = ProductStatus.DRAFT;

    /**
     * Catalog 변경 command가 단조 증가시키며,
     * 같은 transaction에 추가하는 감사 Snapshot revision과 일치해야 한다.
     */
    @Property({ fieldName: 'revision', type: 'integer', default: 1 })
    revision: number & Opt = 1;

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
    deletedAt: Date | null = null;

    @ManyToOne({
        entity: () => MemberEntity,
        fieldName: 'seller_id',
        updateRule: 'cascade',
        deleteRule: 'restrict',
        foreignKeyName: 'products_seller_id_fkey',
        unsigned: false,
        index: false,
    })
    seller!: Rel<MemberEntity>;

    @OneToMany({ entity: () => ItemEntity, mappedBy: 'product' })
    items = new Collection<ItemEntity>(this);

    @OneToMany({ entity: () => ProductOptionEntity, mappedBy: 'product' })
    options = new Collection<ProductOptionEntity>(this);

    @OneToMany({ entity: () => ProductCategoryEntity, mappedBy: 'product' })
    categories = new Collection<ProductCategoryEntity>(this);

    @OneToMany({ entity: () => ProductMediaEntity, mappedBy: 'product' })
    media = new Collection<ProductMediaEntity>(this);

    @OneToMany({ entity: () => ProductTagEntity, mappedBy: 'product' })
    tags = new Collection<ProductTagEntity>(this);

    @OneToMany({ entity: () => ProductSnapshotEntity, mappedBy: 'product' })
    snapshots = new Collection<ProductSnapshotEntity>(this);
}
