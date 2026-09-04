import { EntityManager, QueryOrder } from '@mikro-orm/core';
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';

import { ProductSnapshotChangeType } from '~/api/catalog/domain/entity/product-snapshot-change-type';
import { ProductSnapshotEntity } from '~/api/catalog/domain/entity/product-snapshot.entity';
import { ProductEntity } from '~/api/catalog/domain/entity/product.entity';
import { InvalidProductChange, NotExistingProduct, ProductAccessDenied } from '~/api/catalog/domain/product.error';
import { MemberRole } from '~/api/member/domain/member-role';
import type { JwtPayload } from '~/global/jwt/payload/jwt.payload';

export const DEFAULT_PRODUCT_SNAPSHOT_LIMIT = 20;
export const MAX_PRODUCT_SNAPSHOT_LIMIT = 100;

export interface ProductSnapshotHistoryResult {
    readonly id: bigint;
    readonly productId: bigint;
    readonly revision: number;
    readonly schemaVersion: number;
    readonly changeType: ProductSnapshotChangeType;
    readonly reason: string | null;
    readonly changedByMemberId: bigint | null;
    readonly createdAt: Date;
}

@Injectable()
export class ProductSnapshotService {
    constructor(private readonly em: EntityManager) {}

    async findHistory(
        actor: JwtPayload,
        productId: bigint,
        limit = DEFAULT_PRODUCT_SNAPSHOT_LIMIT
    ): Promise<ProductSnapshotHistoryResult[]> {
        if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PRODUCT_SNAPSHOT_LIMIT) {
            throw new BadRequestException(
                new InvalidProductChange(`Snapshot limit은 1~${MAX_PRODUCT_SNAPSHOT_LIMIT}입니다.`)
            );
        }

        const product = await this.em.findOne(
            ProductEntity,
            { id: productId },
            { populate: ['seller'], connectionType: 'write', disableIdentityMap: true }
        );
        if (!product) throw new NotFoundException(new NotExistingProduct());
        if (
            actor.role !== MemberRole.ADMIN &&
            (actor.role !== MemberRole.SELLER || product.seller.id !== actor.memberId)
        ) {
            throw new ForbiddenException(new ProductAccessDenied());
        }

        const snapshots = await this.em.find(
            ProductSnapshotEntity,
            { product: productId },
            {
                populate: ['changedBy'],
                orderBy: { revision: QueryOrder.DESC },
                limit,
                connectionType: 'write',
                disableIdentityMap: true,
                loggerContext: { label: 'catalog.product-snapshots' },
            }
        );

        return snapshots.map((snapshot) => ({
            id: snapshot.id,
            productId,
            revision: snapshot.revision,
            schemaVersion: snapshot.schemaVersion,
            changeType: snapshot.changeType,
            reason: snapshot.reason,
            changedByMemberId: snapshot.changedBy?.id ?? null,
            createdAt: snapshot.createdAt,
        }));
    }
}
