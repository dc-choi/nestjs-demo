import type { CatalogWriteEffects } from '~/api/catalog/application/catalog-write-effects.port';
import { assertCatalogWritable } from '~/infra/search/catalog-maintenance.service';
import { enqueueSearchProjection } from '~/infra/search/search-projection-outbox.entity';

export const catalogSearchWriteEffects: CatalogWriteEffects = {
    assertWritable: assertCatalogWritable,
    recordChange(tx, product) {
        if (!tx.isInTransaction()) throw new Error('Catalog projection requires the caller transaction');
        enqueueSearchProjection(tx, product, product.revision);
    },
};
