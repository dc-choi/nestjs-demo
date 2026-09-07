import type { EntityManager } from '@mikro-orm/core';

import type { ProductEntity } from '~/api/catalog/domain/entity/product.entity';

export const CATALOG_WRITE_EFFECTS = Symbol('CATALOG_WRITE_EFFECTS');

export interface CatalogWriteEffects {
    /** Acquires the write admission guard for the lifetime of this transaction. */
    assertWritable(tx: EntityManager): Promise<void>;
    /** Registers the current revision for projection in the same transaction, without external I/O. */
    recordChange(tx: EntityManager, product: ProductEntity): void;
}
