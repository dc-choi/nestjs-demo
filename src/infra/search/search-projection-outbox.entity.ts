import { type EntityManager, type Opt, type Rel } from '@mikro-orm/core';
import { Entity, Enum, Index, ManyToOne, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy';

import { ProductEntity } from '~/api/catalog/domain/entity/product.entity';
import { MAX_PRODUCT_REVISION } from '~/api/catalog/search/domain/product-search.document';

export const SearchProjectionOutboxStatus = {
    PENDING: 'PENDING',
    PROCESSING: 'PROCESSING',
    PROCESSED: 'PROCESSED',
    DEAD_LETTER: 'DEAD_LETTER',
} as const;

export type SearchProjectionOutboxStatus =
    (typeof SearchProjectionOutboxStatus)[keyof typeof SearchProjectionOutboxStatus];

@Entity({ tableName: 'search_projection_outbox' })
@Unique({ name: 'search_projection_outbox_product_revision_key', properties: ['product', 'productRevision'] })
@Index({ name: 'search_projection_outbox_status_available_id_idx', properties: ['status', 'availableAt', 'id'] })
@Index({ name: 'search_projection_outbox_lease_idx', properties: ['status', 'leasedUntil'] })
export class SearchProjectionOutboxEntity {
    @PrimaryKey({ fieldName: 'id', columnType: 'bigint', autoincrement: true, unsigned: false })
    id!: bigint;

    @ManyToOne({
        entity: () => ProductEntity,
        fieldName: 'product_id',
        updateRule: 'cascade',
        deleteRule: 'restrict',
        foreignKeyName: 'search_projection_outbox_product_id_fkey',
        unsigned: false,
        index: false,
    })
    product: Rel<ProductEntity>;

    @Property({ fieldName: 'product_revision', type: 'integer' })
    productRevision: number;

    @Enum({
        fieldName: 'status',
        items: () => SearchProjectionOutboxStatus,
        default: SearchProjectionOutboxStatus.PENDING,
    })
    status: SearchProjectionOutboxStatus & Opt = SearchProjectionOutboxStatus.PENDING;

    @Property({ fieldName: 'attempts', type: 'integer', unsigned: true, default: 0 })
    attempts: number & Opt = 0;

    @Property({ fieldName: 'available_at', type: 'datetime', length: 3, defaultRaw: 'CURRENT_TIMESTAMP(3)' })
    availableAt!: Date & Opt;

    @Property({ fieldName: 'lease_token', columnType: 'char(36)', nullable: true })
    leaseToken: string | null = null;

    @Property({ fieldName: 'leased_until', type: 'datetime', length: 3, nullable: true })
    leasedUntil: Date | null = null;

    @Property({ fieldName: 'last_error', columnType: 'varchar(1000)', nullable: true })
    lastError: string | null = null;

    @Property({ fieldName: 'created_at', type: 'datetime', length: 3, defaultRaw: 'CURRENT_TIMESTAMP(3)' })
    createdAt!: Date & Opt;

    @Property({ fieldName: 'processed_at', type: 'datetime', length: 3, nullable: true })
    processedAt: Date | null = null;

    constructor(product: ProductEntity, productRevision: number) {
        if (!Number.isInteger(productRevision) || productRevision < 1 || productRevision > MAX_PRODUCT_REVISION) {
            throw new Error(`Invalid search projection revision: ${productRevision}`);
        }
        if (product.revision !== productRevision) {
            throw new Error(
                `Search projection revision ${productRevision} does not match product revision ${product.revision}`
            );
        }
        this.product = product;
        this.productRevision = productRevision;
    }
}

export function enqueueSearchProjection(
    em: EntityManager,
    product: ProductEntity,
    productRevision: number
): SearchProjectionOutboxEntity {
    const event = new SearchProjectionOutboxEntity(product, productRevision);
    em.persist(event);
    return event;
}
