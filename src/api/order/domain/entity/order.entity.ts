import { Cascade, Collection, type Opt, type Rel } from '@mikro-orm/core';
import { Entity, Enum, Index, ManyToOne, OneToMany, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy';

import { FulfillmentEntity } from '~/api/fulfillment/domain/fulfillment.entity';
import { FulfillmentStatus } from '~/api/fulfillment/domain/fulfillment.enum';
import type { InventoryReservationEntity } from '~/api/inventory/domain/inventory-reservation.entity';
import { InventoryReservationStatus } from '~/api/inventory/domain/inventory.enum';
import { MemberEntity } from '~/api/member/domain/member.entity';
import { assertOrderMoneyFits, sumDecimals } from '~/api/order/domain/decimal';
import { OrderAddressEntity } from '~/api/order/domain/entity/order-address.entity';
import { OrderItemEntity } from '~/api/order/domain/entity/order-item.entity';
import { OrderStatusHistoryEntity } from '~/api/order/domain/entity/order-status-history.entity';
import { OrderActorType, OrderStatus } from '~/api/order/domain/entity/order.enum';
import { PaymentAttemptEntity } from '~/api/payment/domain/payment-attempt.entity';

interface PlaceOrder {
    readonly member: Rel<MemberEntity>;
    readonly orderNumber: string;
    readonly idempotencyKey: string;
    readonly requestFingerprint: string;
    readonly currencyCode: string;
    readonly items: readonly OrderItemEntity[];
    readonly placedAt?: Date;
}

interface TransitionOrder {
    readonly to: OrderStatus;
    readonly actorType: OrderActorType;
    readonly actorId?: string | null;
    readonly reason?: string | null;
    readonly requestId?: string | null;
    readonly metadata?: unknown | null;
    readonly occurredAt?: Date;
}

interface CancelOrder {
    readonly actorId: string;
    readonly reason: string;
    readonly requestId: string;
    readonly occurredAt?: Date;
}

interface ExpireOrderReservations {
    readonly actorType: OrderActorType;
    readonly actorId: string | null;
    readonly requestId: string;
    readonly occurredAt?: Date;
}

export interface OrderCancellationResult {
    readonly isReplay: boolean;
    readonly history: OrderStatusHistoryEntity | null;
    readonly reservations: readonly InventoryReservationEntity[];
}

export class OrderCancellationConflict extends Error {}

const ALLOWED_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
    [OrderStatus.PENDING]: [OrderStatus.CONFIRMED, OrderStatus.CANCELLED],
    [OrderStatus.CONFIRMED]: [OrderStatus.CANCELLED, OrderStatus.COMPLETED],
    [OrderStatus.CANCELLED]: [],
    [OrderStatus.COMPLETED]: [],
};

/**
 * 주문 금액과 현재 상태의 권위가 되는 aggregate root다.
 * 품목, 결제 시도, 배송을 묶고 생성 시 품목 합계와 주문 시점 증거를 함께 확정한다.
 * 상태 전이와 감사 이력은 같은 트랜잭션에서 일관되게 갱신해야 한다.
 */
@Entity({ tableName: 'orders' })
@Unique({ name: 'orders_member_id_idempotency_key_key', properties: ['member', 'idempotencyKey'] })
@Index({ name: 'orders_member_id_created_at_idx', properties: ['member', 'createdAt'] })
@Index({ name: 'orders_status_created_at_idx', properties: ['status', 'createdAt'] })
export class OrderEntity {
    @PrimaryKey({ type: 'bigint', autoincrement: true, unsigned: false })
    id!: bigint;

    @Property({
        fieldName: 'order_number',
        columnType: 'varchar(255)',
        unique: 'orders_order_number_key',
    })
    orderNumber!: string;

    /** 회원 범위에서 주문 생성 재전송을 식별한다. */
    @Property({ fieldName: 'idempotency_key', columnType: 'varchar(128)' })
    idempotencyKey!: string;

    /** 같은 멱등성 키에 다른 요청 내용이 들어왔는지 애플리케이션이 비교하는 값이다. */
    @Property({ fieldName: 'request_fingerprint', columnType: 'char(64)' })
    requestFingerprint!: string;

    /** 조회용 현재값이며 전이할 때 `statusHistories` 추가와 함께 갱신해야 한다. */
    @Enum({ items: () => OrderStatus, default: OrderStatus.PENDING })
    status: OrderStatus & Opt = OrderStatus.PENDING;

    @Property({ fieldName: 'currency_code', columnType: 'char(3)', default: 'KRW' })
    currencyCode: string & Opt = 'KRW';

    @Property({ fieldName: 'total_price', type: 'decimal', precision: 19, scale: 3 })
    totalPrice!: string;

    @Property({ fieldName: 'placed_at', columnType: 'datetime(3)', nullable: true })
    placedAt: Date | null = null;

    @Property({ fieldName: 'cancelled_at', columnType: 'datetime(3)', nullable: true })
    cancelledAt: Date | null = null;

    @Property({ fieldName: 'completed_at', columnType: 'datetime(3)', nullable: true })
    completedAt: Date | null = null;

    @Property({ fieldName: 'created_at', columnType: 'datetime', defaultRaw: 'CURRENT_TIMESTAMP' })
    createdAt!: Date & Opt;

    @Property({
        fieldName: 'updated_at',
        columnType: 'datetime',
        defaultRaw: 'CURRENT_TIMESTAMP',
        onUpdate: () => new Date(),
    })
    updatedAt!: Date & Opt;

    @Property({ fieldName: 'deleted_at', columnType: 'datetime', nullable: true })
    deletedAt: Date | null = null;

    @ManyToOne(() => MemberEntity, {
        joinColumn: 'member_id',
        inversedBy: 'orders',
        deleteRule: 'restrict',
        updateRule: 'cascade',
        foreignKeyName: 'orders_member_id_fkey',
        unsigned: false,
        index: false,
    })
    member!: Rel<MemberEntity>;

    @OneToMany(() => OrderItemEntity, (item) => item.order, { cascade: [Cascade.PERSIST] })
    items = new Collection<OrderItemEntity>(this);

    @OneToMany(() => OrderAddressEntity, (address) => address.order)
    addresses = new Collection<OrderAddressEntity>(this);

    @OneToMany(() => OrderStatusHistoryEntity, (history) => history.order, { cascade: [Cascade.PERSIST] })
    statusHistories = new Collection<OrderStatusHistoryEntity>(this);

    @OneToMany(() => PaymentAttemptEntity, (attempt) => attempt.order)
    paymentAttempts = new Collection<PaymentAttemptEntity>(this);

    @OneToMany(() => FulfillmentEntity, (fulfillment) => fulfillment.order)
    fulfillments = new Collection<FulfillmentEntity>(this);

    static place({
        member,
        orderNumber,
        idempotencyKey,
        requestFingerprint,
        currencyCode,
        items,
        placedAt = new Date(),
    }: PlaceOrder): OrderEntity {
        if (items.length === 0) throw new RangeError('주문 품목은 하나 이상이어야 합니다.');
        if (!/^[A-Z]{3}$/.test(currencyCode)) throw new TypeError('통화 코드는 ISO 4217 형식이어야 합니다.');
        if (idempotencyKey.trim().length === 0 || idempotencyKey.length > 128) {
            throw new RangeError('주문 생성 멱등성 키는 1자 이상 128자 이하여야 합니다.');
        }
        if (!/^[a-f0-9]{64}$/.test(requestFingerprint)) {
            throw new TypeError('주문 요청 fingerprint는 SHA-256 16진수여야 합니다.');
        }
        if (new Set(items).size !== items.length) throw new Error('같은 주문 품목 객체를 중복해서 추가할 수 없습니다.');
        if (items.some(({ order }) => order != null)) {
            throw new Error('이미 주문에 속한 품목을 다시 추가할 수 없습니다.');
        }

        const totalPrice = sumDecimals(items.map(({ lineTotalPrice }) => lineTotalPrice));
        assertOrderMoneyFits(totalPrice);

        const order = new OrderEntity();
        order.member = member;
        order.orderNumber = orderNumber;
        order.idempotencyKey = idempotencyKey;
        order.requestFingerprint = requestFingerprint;
        order.status = OrderStatus.PENDING;
        order.currencyCode = currencyCode;
        order.totalPrice = totalPrice;
        order.placedAt = placedAt;

        for (const item of items) item.order = order;
        order.items = new Collection(order, [...items]);
        order.statusHistories = new Collection(order, [
            OrderStatusHistoryEntity.record({
                order,
                fromStatus: null,
                toStatus: OrderStatus.PENDING,
                actorType: OrderActorType.MEMBER,
                actorId: member.id.toString(),
                createdAt: placedAt,
            }),
        ]);

        return order;
    }

    transition({
        to,
        actorType,
        actorId = null,
        reason = null,
        requestId = null,
        metadata = null,
        occurredAt = new Date(),
    }: TransitionOrder): OrderStatusHistoryEntity | null {
        const fromStatus: OrderStatus = this.status;
        if (fromStatus === to) return null;
        if (!ALLOWED_TRANSITIONS[fromStatus].includes(to)) {
            throw new Error(`주문 상태를 ${fromStatus}에서 ${to}(으)로 변경할 수 없습니다.`);
        }

        this.status = to;

        if (to === OrderStatus.CANCELLED) this.cancelledAt = occurredAt;
        if (to === OrderStatus.COMPLETED) this.completedAt = occurredAt;

        const history = OrderStatusHistoryEntity.record({
            order: this,
            fromStatus,
            toStatus: to,
            actorType,
            actorId,
            reason,
            requestId,
            metadata,
            createdAt: occurredAt,
        });
        if (this.statusHistories.isInitialized()) {
            this.statusHistories = new Collection(this, [...this.statusHistories.getItems(), history]);
        }
        return history;
    }

    cancelByMember({ actorId, reason, requestId, occurredAt = new Date() }: CancelOrder): OrderCancellationResult {
        if (this.status === OrderStatus.CANCELLED) {
            if (this.hasCancellationReplay(requestId, reason)) {
                return { isReplay: true, history: null, reservations: [] };
            }
            throw new OrderCancellationConflict('이미 다른 요청으로 취소된 주문입니다.');
        }
        if (this.status === OrderStatus.COMPLETED) {
            throw new OrderCancellationConflict('완료된 주문은 취소할 수 없습니다.');
        }
        if (
            this.fulfillments
                .getItems()
                .some(({ status }) => status === FulfillmentStatus.SHIPPED || status === FulfillmentStatus.DELIVERED)
        ) {
            throw new OrderCancellationConflict('발송된 배송이 있는 주문은 취소할 수 없습니다.');
        }
        if (this.paymentAttempts.getItems().some((attempt) => attempt.hasUnrefundedCapture())) {
            throw new OrderCancellationConflict('매입된 결제 금액을 모두 환불한 뒤 주문을 취소할 수 있습니다.');
        }
        if (this.paymentAttempts.getItems().some((attempt) => attempt.requiresCancellationBeforeOrderCancellation())) {
            throw new OrderCancellationConflict('승인된 결제를 취소한 뒤 주문을 취소할 수 있습니다.');
        }

        const reservations = this.cancellableReservations();
        this.cancelCancellablePaymentAttempts(occurredAt);
        for (const fulfillment of this.fulfillments) fulfillment.cancel(occurredAt);
        const history = this.transition({
            to: OrderStatus.CANCELLED,
            actorType: OrderActorType.MEMBER,
            actorId,
            reason,
            requestId,
            occurredAt,
        });
        return { isReplay: false, history, reservations };
    }

    expireReservations({
        actorType,
        actorId,
        requestId,
        occurredAt = new Date(),
    }: ExpireOrderReservations): OrderCancellationResult {
        if (this.status !== OrderStatus.PENDING) {
            throw new OrderCancellationConflict('결제 대기 주문의 재고 예약만 만료할 수 있습니다.');
        }
        const reservations = this.inventoryReservations();
        if (reservations.length !== this.items.length) {
            throw new OrderCancellationConflict('모든 주문 품목에 재고 예약이 있어야 합니다.');
        }
        if (
            reservations.some(
                ({ status }) =>
                    status !== InventoryReservationStatus.RESERVED && status !== InventoryReservationStatus.EXPIRED
            )
        ) {
            throw new OrderCancellationConflict('소비되거나 해제된 재고 예약이 있는 주문은 만료할 수 없습니다.');
        }
        const activeReservations = reservations.filter(({ status }) => status === InventoryReservationStatus.RESERVED);
        if (activeReservations.length === 0) {
            throw new OrderCancellationConflict('이미 다른 요청으로 만료된 주문입니다.');
        }
        if (activeReservations.some(({ expiresAt }) => expiresAt.getTime() > occurredAt.getTime())) {
            throw new OrderCancellationConflict('아직 만료되지 않은 재고 예약이 있는 주문입니다.');
        }
        if (
            this.paymentAttempts
                .getItems()
                .some((attempt) => !attempt.isCancellable() && !attempt.isTerminalForReservationExpiration())
        ) {
            throw new OrderCancellationConflict('취소할 수 없는 결제 시도가 있는 주문은 만료할 수 없습니다.');
        }

        this.cancelCancellablePaymentAttempts(occurredAt);
        const history = this.transition({
            to: OrderStatus.CANCELLED,
            actorType,
            actorId,
            reason: 'INVENTORY_RESERVATION_EXPIRED',
            requestId,
            occurredAt,
        });
        return { isReplay: false, history, reservations: activeReservations };
    }

    private hasCancellationReplay(requestId: string, reason: string): boolean {
        return this.statusHistories
            .getItems()
            .some(
                (history) =>
                    history.toStatus === OrderStatus.CANCELLED &&
                    history.requestId === requestId &&
                    history.reason === reason
            );
    }

    private cancellableReservations(): InventoryReservationEntity[] {
        return this.inventoryReservations().filter(
            ({ status }) =>
                status === InventoryReservationStatus.RESERVED || status === InventoryReservationStatus.CONSUMED
        );
    }

    private inventoryReservations(): InventoryReservationEntity[] {
        return this.items
            .getItems()
            .flatMap(({ inventoryReservation }) => (inventoryReservation ? [inventoryReservation] : []));
    }

    private cancelCancellablePaymentAttempts(now: Date): void {
        for (const attempt of this.paymentAttempts) {
            if (attempt.isCancellable()) attempt.cancel(now);
        }
    }
}
