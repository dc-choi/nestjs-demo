import type { CatalogWriteEffects } from '~/api/catalog/application/catalog-write-effects.port.js';
import { assertCatalogWritable } from '~/infra/search/catalog-maintenance.service.js';
import { enqueueSearchProjection } from '~/infra/search/search-projection-outbox.entity.js';

export const catalogSearchWriteEffects: CatalogWriteEffects = {
    assertWritable: assertCatalogWritable,
    recordChange(tx, product) {
        if (!tx.isInTransaction()) throw new Error('Catalog projection requires the caller transaction');
        enqueueSearchProjection(tx, product, product.revision);
    },
};
