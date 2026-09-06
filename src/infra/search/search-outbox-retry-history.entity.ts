import { type Opt, type Rel } from '@mikro-orm/core';
import { Entity, Index, ManyToOne, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';

import { SearchProjectionOutboxEntity } from './search-projection-outbox.entity';

import { ProductEntity } from '~/api/catalog/domain/entity/product.entity';

@Entity({ tableName: 'search_projection_outbox_retry_history' })
@Index({ name: 'search_projection_outbox_retry_history_outbox_created_idx', properties: ['outbox', 'createdAt'] })
@Index({ name: 'search_projection_outbox_retry_history_product_created_idx', properties: ['product', 'createdAt'] })
export class SearchOutboxRetryHistoryEntity {
    @PrimaryKey({ fieldName: 'id', columnType: 'bigint', autoincrement: true, unsigned: false })
    id!: bigint;

    @ManyToOne({
        entity: () => SearchProjectionOutboxEntity,
        fieldName: 'outbox_id',
        updateRule: 'cascade',
        deleteRule: 'restrict',
        foreignKeyName: 'search_projection_outbox_retry_history_outbox_id_fkey',
        unsigned: false,
        index: false,
    })
    outbox!: Rel<SearchProjectionOutboxEntity>;

    @ManyToOne({
        entity: () => ProductEntity,
        fieldName: 'product_id',
        updateRule: 'cascade',
        deleteRule: 'restrict',
        foreignKeyName: 'search_projection_outbox_retry_history_product_id_fkey',
        unsigned: false,
        index: false,
    })
    product!: Rel<ProductEntity>;

    @Property({ fieldName: 'previous_attempts', type: 'integer', unsigned: true })
    previousAttempts!: number;

    @Property({ fieldName: 'previous_last_error', columnType: 'varchar(1000)', nullable: true })
    previousLastError: string | null = null;

    @Property({ fieldName: 'action', columnType: 'varchar(32)' })
    action!: string;

    @Property({ fieldName: 'reason', columnType: 'varchar(500)' })
    reason!: string;

    @Property({ fieldName: 'created_at', type: 'datetime', length: 3, defaultRaw: 'CURRENT_TIMESTAMP(3)' })
    createdAt!: Date & Opt;
}
