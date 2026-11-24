import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Module } from '@nestjs/common';

import { CATALOG_WRITE_EFFECTS } from '~/api/catalog/application/catalog-write-effects.port.js';
import { ProductCommandService } from '~/api/catalog/application/product-command.service.js';
import { ProductSnapshotService } from '~/api/catalog/application/product-snapshot.service.js';
import { ProductService } from '~/api/catalog/application/product.service.js';
import { ProductEntity } from '~/api/catalog/domain/entity/product.entity.js';
import { ProductCommandResolver } from '~/api/catalog/presentation/product-command.resolver.js';
import { ProductSnapshotResolver } from '~/api/catalog/presentation/product-snapshot.resolver.js';
import { ProductResolver } from '~/api/catalog/presentation/product.resolver.js';
import { catalogSearchWriteEffects } from '~/infra/search/catalog-write-effects.js';

@Module({
    imports: [MikroOrmModule.forFeature([ProductEntity])],
    providers: [
        { provide: CATALOG_WRITE_EFFECTS, useValue: catalogSearchWriteEffects },
        ProductCommandService,
        ProductService,
        ProductSnapshotService,
        ProductCommandResolver,
        ProductResolver,
        ProductSnapshotResolver,
    ],
})
export class CatalogModule {}
