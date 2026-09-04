import { type Opt, type Rel } from '@mikro-orm/core';
import { Entity, Enum, Index, ManyToOne, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy';

import { ProductSnapshotChangeType } from './product-snapshot-change-type';
import type { ProductSnapshotPayload } from './product-snapshot-payload';
import { ProductEntity } from './product.entity';

import { MemberEntity } from '~/api/member/domain/member.entity';

/**
 * live Product graph의 revision별 전체 상태를 보존하는 append-only 감사 이력이다.
 * 일반 상품 조회와 주문의 현재본이 아니며, 복원도 과거 행을 수정하지 않고 새 revision을 추가한다.
 * append-only 정책과 live graph 동시 저장은 Catalog 변경 command가 보호한다.
 */
@Entity({ tableName: 'product_snapshots' })
@Unique({ name: 'product_snapshots_product_id_revision_key', properties: ['product', 'revision'] })
@Index({ name: 'product_snapshots_product_id_created_at_idx', properties: ['product', 'createdAt'] })
@Index({ name: 'product_snapshots_changed_by_member_id_idx', properties: ['changedBy'] })
export class ProductSnapshotEntity {
    @PrimaryKey({ fieldName: 'id', columnType: 'bigint', autoincrement: true, unsigned: false })
    id!: bigint;

    /** 같은 transaction에서 확정된 live Product.revision을 기록하며 Product별 중복을 허용하지 않는다. */
    @Property({ fieldName: 'revision', type: 'integer' })
    revision!: number;

    /** payload 구조가 바뀌어도 과거 이력을 버전별로 해석하기 위한 형식 버전이다. */
    @Property({ fieldName: 'schema_version', type: 'integer', unsigned: true })
    schemaVersion!: number;

    /** 어떤 Catalog 변경이 이 revision을 만들었는지 감사 목적으로 분류한다. */
    @Enum({ fieldName: 'change_type', items: () => ProductSnapshotChangeType })
    changeType!: ProductSnapshotChangeType;

    /** 변경 후 live Catalog graph의 재구성 가능한 전체 상태이며, 독립 생명주기의 재고는 포함하지 않는다. */
    @Property({ fieldName: 'payload', type: 'json' })
    payload!: ProductSnapshotPayload;

    @Property({ fieldName: 'reason', columnType: 'varchar(500)', nullable: true })
    reason: string | null = null;

    @Property({ fieldName: 'created_at', type: 'datetime', length: 3, defaultRaw: 'CURRENT_TIMESTAMP(3)' })
    createdAt!: Date & Opt;

    @ManyToOne({
        entity: () => ProductEntity,
        fieldName: 'product_id',
        updateRule: 'cascade',
        deleteRule: 'restrict',
        foreignKeyName: 'product_snapshots_product_id_fkey',
        unsigned: false,
        index: false,
    })
    product!: Rel<ProductEntity>;

    /** 회원이 수행한 변경의 감사 주체이며, 회원 행위자가 없는 변경은 null이다. */
    @ManyToOne({
        entity: () => MemberEntity,
        fieldName: 'changed_by_member_id',
        updateRule: 'cascade',
        deleteRule: 'restrict',
        foreignKeyName: 'product_snapshots_changed_by_member_id_fkey',
        nullable: true,
        unsigned: false,
        index: false,
    })
    changedBy: Rel<MemberEntity> | null = null;
}
