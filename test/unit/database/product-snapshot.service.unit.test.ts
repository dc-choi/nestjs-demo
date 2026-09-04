import { jest } from '@jest/globals';
import { EntityManager, QueryOrder } from '@mikro-orm/core';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';

import { MAX_PRODUCT_SNAPSHOT_LIMIT, ProductSnapshotService } from '~/api/catalog/application/product-snapshot.service';
import { ProductSnapshotChangeType } from '~/api/catalog/domain/entity/product-snapshot-change-type';
import { ProductSnapshotEntity } from '~/api/catalog/domain/entity/product-snapshot.entity';
import { ProductEntity } from '~/api/catalog/domain/entity/product.entity';
import { MemberRole } from '~/api/member/domain/member-role';
import { MemberEntity } from '~/api/member/domain/member.entity';

describe('ProductSnapshotService', () => {
    const findOne = jest.fn<EntityManager['findOne']>();
    const find = jest.fn<EntityManager['find']>();
    const service = new ProductSnapshotService({ findOne, find } as unknown as EntityManager);

    beforeEach(() => {
        findOne.mockReset();
        find.mockReset();
    });

    it('소유 판매자에게 최신 revision 순으로 bounded Snapshot metadata를 반환한다', async () => {
        const product = createProduct(7n);
        const changedBy = Object.assign(new MemberEntity(), { id: 8n });
        findOne.mockResolvedValue(product as never);
        find.mockResolvedValue([
            Object.assign(new ProductSnapshotEntity(), {
                id: 102n,
                product,
                revision: 2,
                schemaVersion: 1,
                changeType: ProductSnapshotChangeType.UPDATE,
                reason: '수정',
                changedBy,
                createdAt: new Date('2026-09-04T02:00:00.000Z'),
            }),
            Object.assign(new ProductSnapshotEntity(), {
                id: 101n,
                product,
                revision: 1,
                schemaVersion: 1,
                changeType: ProductSnapshotChangeType.CREATE,
                reason: null,
                changedBy: null,
                createdAt: new Date('2026-09-04T01:00:00.000Z'),
            }),
        ] as never);

        const result = await service.findHistory({ memberId: 7n, role: MemberRole.SELLER }, product.id, 10);

        expect(find).toHaveBeenCalledWith(
            ProductSnapshotEntity,
            { product: product.id },
            expect.objectContaining({
                orderBy: { revision: QueryOrder.DESC },
                limit: 10,
                connectionType: 'write',
                disableIdentityMap: true,
            })
        );
        expect(result).toEqual([
            expect.objectContaining({ id: 102n, productId: product.id, revision: 2, changedByMemberId: 8n }),
            expect.objectContaining({ id: 101n, productId: product.id, revision: 1, changedByMemberId: null }),
        ]);
    });

    it('관리자는 다른 판매자의 Snapshot 이력을 조회할 수 있다', async () => {
        findOne.mockResolvedValue(createProduct(7n) as never);
        find.mockResolvedValue([] as never);

        await expect(service.findHistory({ memberId: 99n, role: MemberRole.ADMIN }, 42n, 1)).resolves.toEqual([]);
    });

    it('다른 판매자와 고객의 Snapshot 이력 접근을 거부한다', async () => {
        findOne.mockResolvedValue(createProduct(7n) as never);

        await expect(service.findHistory({ memberId: 8n, role: MemberRole.SELLER }, 42n, 10)).rejects.toBeInstanceOf(
            ForbiddenException
        );
        await expect(service.findHistory({ memberId: 7n, role: MemberRole.CUSTOMER }, 42n, 10)).rejects.toBeInstanceOf(
            ForbiddenException
        );
        expect(find).not.toHaveBeenCalled();
    });

    it('없는 상품과 범위를 넘은 limit을 거부한다', async () => {
        findOne.mockResolvedValue(null);

        await expect(service.findHistory({ memberId: 7n, role: MemberRole.SELLER }, 42n, 10)).rejects.toBeInstanceOf(
            NotFoundException
        );
        await expect(
            service.findHistory({ memberId: 7n, role: MemberRole.SELLER }, 42n, MAX_PRODUCT_SNAPSHOT_LIMIT + 1)
        ).rejects.toBeInstanceOf(BadRequestException);
    });
});

function createProduct(sellerId: bigint): ProductEntity {
    return Object.assign(new ProductEntity(), {
        id: 42n,
        seller: Object.assign(new MemberEntity(), { id: sellerId }),
    });
}
