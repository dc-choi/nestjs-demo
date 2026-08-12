import { Module } from '@nestjs/common';

import { GetProductQuery } from '~/api/catalog/application/get-product.query';
import { PRODUCT_READER } from '~/api/catalog/application/product.reader';
import { PrismaProductReader } from '~/api/catalog/infrastructure/prisma-product.reader';
import { ProductResolver } from '~/api/catalog/presentation/product.resolver';

@Module({
    providers: [
        GetProductQuery,
        PrismaProductReader,
        {
            provide: PRODUCT_READER,
            useExisting: PrismaProductReader,
        },
        ProductResolver,
    ],
})
export class CatalogModule {}
