import type { CatalogWriteEffects } from '~/api/catalog/application/catalog-write-effects.port.js';
import { assertCatalogWritable } from '~/api/search/application/catalog-maintenance.service.js';
import { SearchProjectionOutboxEntity } from '~/api/search/domain/entity/search-projection-outbox.entity.js';

export const catalogSearchWriteEffects: CatalogWriteEffects = {
    assertWritable: assertCatalogWritable,
    recordChange(tx, product) {
        if (!tx.isInTransaction()) throw new Error('Catalog projection requires the caller transaction');
        tx.persist(new SearchProjectionOutboxEntity(product, product.revision));
    },
};
