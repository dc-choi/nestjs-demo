import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Module } from '@nestjs/common';

import { CATALOG_WRITE_EFFECTS } from '~/api/catalog/application/catalog-write-effects.port';
import { ProductCommandService } from '~/api/catalog/application/product-command.service';
import { ProductSnapshotService } from '~/api/catalog/application/product-snapshot.service';
import { ProductService } from '~/api/catalog/application/product.service';
import { ProductEntity } from '~/api/catalog/domain/entity/product.entity';
import { ProductCommandResolver } from '~/api/catalog/presentation/product-command.resolver';
import { ProductSnapshotResolver } from '~/api/catalog/presentation/product-snapshot.resolver';
import { ProductResolver } from '~/api/catalog/presentation/product.resolver';
import { catalogSearchWriteEffects } from '~/infra/search/catalog-write-effects';

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
