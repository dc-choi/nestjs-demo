import { UseGuards } from '@nestjs/common';
import { Args, ID, Int, Query, Resolver } from '@nestjs/graphql';

import {
    DEFAULT_PRODUCT_SNAPSHOT_LIMIT,
    ProductSnapshotHistoryResult,
    ProductSnapshotService,
} from '~/api/catalog/application/product-snapshot.service';
import { parseProductId } from '~/api/catalog/presentation/product-id.parser';
import { ProductSnapshotType } from '~/api/catalog/presentation/product-snapshot.type';
import { Jwt } from '~/global/jwt/decorator/jwt.decorator';
import { SellerGuard } from '~/global/jwt/guard/seller.guard';
import type { JwtPayload } from '~/global/jwt/payload/jwt.payload';

@Resolver(() => ProductSnapshotType)
export class ProductSnapshotResolver {
    constructor(private readonly productSnapshotService: ProductSnapshotService) {}

    @Query(() => [ProductSnapshotType], { description: '판매자용 상품 Snapshot 이력' })
    @UseGuards(SellerGuard)
    async productSnapshots(
        @Jwt() actor: JwtPayload,
        @Args('productId', { type: () => ID }) productId: string,
        @Args('limit', { type: () => Int, defaultValue: DEFAULT_PRODUCT_SNAPSHOT_LIMIT }) limit: number
    ): Promise<ProductSnapshotType[]> {
        const history = await this.productSnapshotService.findHistory(actor, parseProductId(productId), limit);
        return history.map(toProductSnapshotType);
    }
}

function toProductSnapshotType(snapshot: ProductSnapshotHistoryResult): ProductSnapshotType {
    return {
        id: snapshot.id.toString(),
        productId: snapshot.productId.toString(),
        revision: snapshot.revision,
        schemaVersion: snapshot.schemaVersion,
        changeType: snapshot.changeType,
        reason: snapshot.reason,
        changedByMemberId: snapshot.changedByMemberId?.toString() ?? null,
        createdAt: snapshot.createdAt,
    };
}
