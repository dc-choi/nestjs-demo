import { Collection, type Opt, type Rel } from '@mikro-orm/core';
import { Entity, Enum, Index, ManyToOne, OneToMany, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy';

import { FulfillmentItemEntity } from '~/api/fulfillment/domain/fulfillment-item.entity';
import { FulfillmentStatus } from '~/api/fulfillment/domain/fulfillment.enum';
import { OrderItemEntity } from '~/api/order/domain/entity/order-item.entity';
import { OrderEntity } from '~/api/order/domain/entity/order.entity';
import { isPositiveMysqlSignedInt } from '~/global/common/utils/mysql-number';

const CANCELLABLE_STATUSES: readonly FulfillmentStatus[] = [FulfillmentStatus.PENDING, FulfillmentStatus.PACKED];

/**
 * 주문 안에서 함께 포장하고 발송하는 배송 단위다.
 * 한 주문에 여러 행을 둘 수 있어 분할 배송을 표현하며 상태와 상태별 시각을 함께 갱신한다.
 * 운송장 인덱스는 조회용이며 유일성을 보장하지 않는다.
 */
@Entity({ tableName: 'fulfillments' })
@Unique({ name: 'fulfillments_order_id_idempotency_key_key', properties: ['order', 'idempotencyKey'] })
@Index({ name: 'fulfillments_order_id_status_idx', properties: ['order', 'status'] })
@Index({ name: 'fulfillments_carrier_tracking_number_idx', properties: ['carrier', 'trackingNumber'] })
export class FulfillmentEntity {
    static create(
        order: Rel<OrderEntity>,
        idempotencyKey: string,
        allocations: readonly { readonly orderItem: Rel<OrderItemEntity>; readonly quantity: number }[]
    ): FulfillmentEntity {
        if (idempotencyKey.trim().length === 0 || idempotencyKey.length > 128) {
            throw new RangeError('배송 생성 멱등성 키는 1자 이상 128자 이하여야 합니다.');
        }
        if (allocations.length === 0) throw new RangeError('배송 품목은 하나 이상이어야 합니다.');
        if (new Set(allocations.map(({ orderItem }) => orderItem)).size !== allocations.length) {
            throw new Error('한 배송에 같은 주문 품목을 중복 배정할 수 없습니다.');
        }
        if (allocations.some(({ orderItem }) => orderItem.order !== order)) {
            throw new Error('다른 주문의 품목을 배송에 배정할 수 없습니다.');
        }
        if (
            allocations.some(
                ({ orderItem, quantity }) => !isPositiveMysqlSignedInt(quantity) || quantity > orderItem.quantity
            )
        ) {
            throw new RangeError('배송 수량은 1 이상 2147483647 이하의 정수이며 주문 수량 이하여야 합니다.');
        }

        const fulfillment = new FulfillmentEntity();
        fulfillment.order = order;
        fulfillment.idempotencyKey = idempotencyKey;
        for (const allocation of allocations) {
            FulfillmentItemEntity.allocate(fulfillment, allocation.orderItem, allocation.quantity);
        }
        order.fulfillments = new Collection(order, [...order.fulfillments.getItems(), fulfillment]);

        return fulfillment;
    }

    pack(now = new Date()): boolean {
        if (this.status === FulfillmentStatus.PACKED) return false;
        this.assertStatus(FulfillmentStatus.PENDING, '포장');
        this.status = FulfillmentStatus.PACKED;
        this.packedAt = now;
        return true;
    }

    ship(carrier: string, trackingNumber: string, now = new Date()): boolean {
        if (this.status === FulfillmentStatus.SHIPPED) {
            if (this.carrier !== carrier || this.trackingNumber !== trackingNumber) {
                throw new Error('이미 발송된 배송의 운송 정보를 변경할 수 없습니다.');
            }
            return false;
        }
        if (carrier.trim().length === 0 || carrier.length > 128) throw new RangeError('택배사 값이 올바르지 않습니다.');
        if (trackingNumber.trim().length === 0 || trackingNumber.length > 255) {
            throw new RangeError('운송장 번호가 올바르지 않습니다.');
        }

        this.assertStatus(FulfillmentStatus.PACKED, '발송');
        this.status = FulfillmentStatus.SHIPPED;
        this.carrier = carrier;
        this.trackingNumber = trackingNumber;
        this.shippedAt = now;
        return true;
    }

    deliver(now = new Date()): boolean {
        if (this.status === FulfillmentStatus.DELIVERED) return false;
        this.assertStatus(FulfillmentStatus.SHIPPED, '배송 완료');
        this.status = FulfillmentStatus.DELIVERED;
        this.deliveredAt = now;
        return true;
    }

    cancel(now = new Date()): boolean {
        if (this.status === FulfillmentStatus.CANCELLED) return false;
        if (!CANCELLABLE_STATUSES.includes(this.status)) {
            throw new Error(`${this.status} 배송은 취소할 수 없습니다.`);
        }

        this.status = FulfillmentStatus.CANCELLED;
        this.cancelledAt = now;
        return true;
    }

    private assertStatus(expected: FulfillmentStatus, action: string): void {
        if (this.status !== expected) throw new Error(`${this.status} 배송은 ${action} 처리할 수 없습니다.`);
    }

    @PrimaryKey({ type: 'bigint', autoincrement: true, unsigned: false })
    id!: bigint;

    /** 같은 주문 안에서 배송 생성 요청의 재실행을 식별한다. */
    @Property({ fieldName: 'idempotency_key', columnType: 'varchar(128)' })
    idempotencyKey!: string;

    /** 현재 배송 단계이며 각 상태별 시각과 일치해야 한다. */
    @Enum({ items: () => FulfillmentStatus, default: FulfillmentStatus.PENDING })
    status: FulfillmentStatus & Opt = FulfillmentStatus.PENDING;

    @Property({ columnType: 'varchar(128)', nullable: true })
    carrier: string | null = null;

    /** carrier와 함께 조회할 수 있지만 같은 값의 중복 저장을 DB가 막지는 않는다. */
    @Property({ fieldName: 'tracking_number', columnType: 'varchar(255)', nullable: true })
    trackingNumber: string | null = null;

    @Property({ fieldName: 'packed_at', columnType: 'datetime(3)', nullable: true })
    packedAt: Date | null = null;

    @Property({ fieldName: 'shipped_at', columnType: 'datetime(3)', nullable: true })
    shippedAt: Date | null = null;

    @Property({ fieldName: 'delivered_at', columnType: 'datetime(3)', nullable: true })
    deliveredAt: Date | null = null;

    @Property({ fieldName: 'cancelled_at', columnType: 'datetime(3)', nullable: true })
    cancelledAt: Date | null = null;

    @Property({ fieldName: 'created_at', columnType: 'datetime(3)', defaultRaw: 'CURRENT_TIMESTAMP(3)' })
    createdAt!: Date & Opt;

    @Property({
        fieldName: 'updated_at',
        columnType: 'datetime(3)',
        defaultRaw: 'CURRENT_TIMESTAMP(3)',
        onUpdate: () => new Date(),
    })
    updatedAt!: Date & Opt;

    @ManyToOne(() => OrderEntity, {
        joinColumn: 'order_id',
        inversedBy: 'fulfillments',
        deleteRule: 'restrict',
        updateRule: 'cascade',
        foreignKeyName: 'fulfillments_order_id_fkey',
        unsigned: false,
        index: false,
    })
    order!: Rel<OrderEntity>;

    @OneToMany(() => FulfillmentItemEntity, (item) => item.fulfillment)
    items = new Collection<FulfillmentItemEntity>(this);
}
