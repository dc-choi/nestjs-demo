import { Collection, type Opt, type Rel } from '@mikro-orm/core';
import { Entity, Enum, Index, ManyToOne, OneToMany, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';

import { ItemSaleStatus } from './item-sale-status';
import { ItemEntity } from './item.entity';
import { ProductCategoryEntity } from './product-category.entity';
import { ProductMediaEntity } from './product-media.entity';
import { ProductOptionEntity } from './product-option.entity';
import type { ProductSnapshotPayload } from './product-snapshot-payload';
import { ProductSnapshotEntity } from './product-snapshot.entity';
import { ProductStatus } from './product-status';
import { ProductTagEntity } from './product-tag.entity';

import {
    PRODUCT_NAME_MAX_LENGTH,
    ProductRuleError,
    normalizeNullableText,
    normalizeRequiredText,
    normalizeSlug,
} from '~/api/catalog/domain/product.rules';
import { MemberEntity } from '~/api/member/domain/member.entity';

export interface CreateProduct {
    readonly slug: string;
    readonly name: string;
    readonly description?: string | null;
    readonly returnPolicy?: string | null;
    readonly seller: Rel<MemberEntity>;
}

export interface ProductChanges {
    readonly slug?: string;
    readonly name?: string;
    readonly description?: string | null;
    readonly returnPolicy?: string | null;
    readonly status?: ProductStatus;
}

const productStatuses = new Set<ProductStatus>(Object.values(ProductStatus));

function assertProductStatus(status: ProductStatus): ProductStatus {
    if (!productStatuses.has(status)) throw new ProductRuleError('상품 상태가 올바르지 않습니다.');
    return status;
}

/**
 * 현재 판매 상태의 권위 원본인 Product aggregate root다.
 * Item, 옵션, 카테고리, 미디어와 태그 graph를 소유하며 감사 Snapshot은 이를 대체하지 않는다.
 * scalar 필드 정규화, 상태 값 검증과 ACTIVE 상품의 판매 가능 Item 불변식은 이 Entity가 보호하고,
 * graph 규칙은 CatalogGraph가, transaction과 권한, revision 조율은 command Service가 맡는다.
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

    /** Creates a DRAFT product at revision 1 with every scalar field normalized. */
    static create({ slug, name, description, returnPolicy, seller }: CreateProduct): ProductEntity {
        const product = new ProductEntity();
        product.slug = normalizeSlug(slug);
        product.name = normalizeRequiredText(name, '상품명', PRODUCT_NAME_MAX_LENGTH);
        product.description = normalizeNullableText(description, '상품 설명');
        product.returnPolicy = normalizeNullableText(returnPolicy, '반품 정책');
        product.status = ProductStatus.DRAFT;
        product.revision = 1;
        product.seller = seller;
        return product;
    }

    /** Applies the given fields after normalization and reports whether anything actually changed. */
    applyChanges(changes: ProductChanges): boolean {
        // Normalize everything first so a violation in a later field leaves no partial change behind.
        const next = {
            slug: changes.slug === undefined ? this.slug : normalizeSlug(changes.slug),
            name:
                changes.name === undefined
                    ? this.name
                    : normalizeRequiredText(changes.name, '상품명', PRODUCT_NAME_MAX_LENGTH),
            description:
                changes.description === undefined
                    ? this.description
                    : normalizeNullableText(changes.description, '상품 설명'),
            returnPolicy:
                changes.returnPolicy === undefined
                    ? this.returnPolicy
                    : normalizeNullableText(changes.returnPolicy, '반품 정책'),
            status: changes.status === undefined ? this.status : assertProductStatus(changes.status),
        };
        const changed =
            next.slug !== this.slug ||
            next.name !== this.name ||
            next.description !== this.description ||
            next.returnPolicy !== this.returnPolicy ||
            next.status !== this.status;

        Object.assign(this, next);
        return changed;
    }

    /**
     * Brings the product-level fields of an audit snapshot back onto this live row and revives it.
     * Requires `seller` to be loaded; the caller holds the row lock and restores the graph afterwards.
     */
    restoreFrom(snapshot: ProductSnapshotPayload['product']): void {
        if (snapshot.id !== this.id.toString() || snapshot.sellerId !== this.seller.id.toString()) {
            throw new ProductRuleError('Snapshot의 상품 식별 정보가 일치하지 않습니다.');
        }
        if (!productStatuses.has(snapshot.status))
            throw new ProductRuleError('Snapshot의 상품 상태가 올바르지 않습니다.');

        const restored = {
            slug: normalizeSlug(snapshot.slug),
            name: normalizeRequiredText(snapshot.name, '상품명', PRODUCT_NAME_MAX_LENGTH),
            description: normalizeNullableText(snapshot.description, '상품 설명'),
            returnPolicy: normalizeNullableText(snapshot.returnPolicy, '반품 정책'),
            status: snapshot.status,
            deletedAt: null,
        };

        Object.assign(this, restored);
    }

    /** Soft-deletes the product: it leaves the catalog but keeps its rows and audit history. */
    close(now = new Date()): void {
        this.status = ProductStatus.CLOSED;
        this.deletedAt = now;
    }

    /** Every catalog change advances the revision exactly once so the audit snapshot can share it. */
    advanceRevision(): number {
        this.revision += 1;
        return this.revision;
    }

    /** An ACTIVE product must expose at least one saleable, non-deleted item. Requires `items` to be populated. */
    assertSaleableWhenActive(): void {
        if (this.status !== ProductStatus.ACTIVE) return;

        const hasSaleableItem = this.items
            .getItems()
            .some(({ saleStatus, deletedAt }) => saleStatus === ItemSaleStatus.ALLOW && deletedAt === null);
        if (!hasSaleableItem) throw new ProductRuleError('ACTIVE 상품은 판매 가능한 Item이 하나 이상 필요합니다.');
    }
}
