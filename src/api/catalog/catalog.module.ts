import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Module } from '@nestjs/common';

import { ProductCommandService } from '~/api/catalog/application/product-command.service';
import { ProductSnapshotService } from '~/api/catalog/application/product-snapshot.service';
import { ProductService } from '~/api/catalog/application/product.service';
import { ProductEntity } from '~/api/catalog/domain/entity/product.entity';
import { ProductCommandResolver } from '~/api/catalog/presentation/product-command.resolver';
import { ProductSnapshotResolver } from '~/api/catalog/presentation/product-snapshot.resolver';
import { ProductResolver } from '~/api/catalog/presentation/product.resolver';

@Module({
    imports: [MikroOrmModule.forFeature([ProductEntity])],
    providers: [
        ProductCommandService,
        ProductService,
        ProductSnapshotService,
        ProductCommandResolver,
        ProductResolver,
        ProductSnapshotResolver,
    ],
})
export class CatalogModule {}
