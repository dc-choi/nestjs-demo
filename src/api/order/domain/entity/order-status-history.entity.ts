import type { Opt, Rel } from '@mikro-orm/core';
import { Entity, Enum, Index, ManyToOne, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';

import { OrderEntity } from '~/api/order/domain/entity/order.entity';
import { OrderActorType, OrderStatus } from '~/api/order/domain/entity/order.enum';

/**
 * 주문 상태 전이의 추가 전용 감사 기록이다.
 * `OrderEntity.status`가 현재값의 권위이며, 상태 변경과 이력 추가는 한 트랜잭션에서 처리한다.
 * `requestId`는 추적용 인덱스일 뿐 중복 방지 키가 아니다.
 */
@Entity({ tableName: 'order_status_histories' })
@Index({ name: 'order_status_histories_order_id_created_at_idx', properties: ['order', 'createdAt'] })
@Index({ name: 'order_status_histories_request_id_idx', properties: ['requestId'] })
export class OrderStatusHistoryEntity {
    static record({
        order,
        fromStatus,
        toStatus,
        actorType,
        actorId = null,
        reason = null,
        requestId = null,
        metadata = null,
        createdAt = new Date(),
    }: {
        readonly order: Rel<OrderEntity>;
        readonly fromStatus: OrderStatus | null;
        readonly toStatus: OrderStatus;
        readonly actorType: OrderActorType;
        readonly actorId?: string | null;
        readonly reason?: string | null;
        readonly requestId?: string | null;
        readonly metadata?: unknown | null;
        readonly createdAt?: Date;
    }): OrderStatusHistoryEntity {
        const history = new OrderStatusHistoryEntity();
        history.order = order;
        history.fromStatus = fromStatus;
        history.toStatus = toStatus;
        history.actorType = actorType;
        history.actorId = actorId;
        history.reason = reason;
        history.requestId = requestId;
        history.metadata = metadata;
        history.createdAt = createdAt;

        return history;
    }

    @PrimaryKey({ type: 'bigint', autoincrement: true, unsigned: false })
    id!: bigint;

    /** 최초 상태 기록처럼 이전 상태가 없을 때는 null이다. */
    @Enum({ fieldName: 'from_status', items: () => OrderStatus, nullable: true })
    fromStatus: OrderStatus | null = null;

    @Enum({ fieldName: 'to_status', items: () => OrderStatus })
    toStatus!: OrderStatus;

    @Property({ columnType: 'varchar(255)', nullable: true })
    reason: string | null = null;

    @Enum({ fieldName: 'actor_type', items: () => OrderActorType, default: OrderActorType.SYSTEM })
    actorType: OrderActorType & Opt = OrderActorType.SYSTEM;

    @Property({ fieldName: 'actor_id', columnType: 'varchar(255)', nullable: true })
    actorId: string | null = null;

    @Property({ fieldName: 'request_id', columnType: 'varchar(255)', nullable: true })
    requestId: string | null = null;

    @Property({ type: 'json', nullable: true })
    metadata: unknown | null = null;

    @Property({ fieldName: 'created_at', columnType: 'datetime(3)', defaultRaw: 'CURRENT_TIMESTAMP(3)' })
    createdAt!: Date & Opt;

    @ManyToOne(() => OrderEntity, {
        joinColumn: 'order_id',
        inversedBy: 'statusHistories',
        deleteRule: 'restrict',
        updateRule: 'cascade',
        foreignKeyName: 'order_status_histories_order_id_fkey',
        unsigned: false,
        index: false,
    })
    order!: Rel<OrderEntity>;
}
