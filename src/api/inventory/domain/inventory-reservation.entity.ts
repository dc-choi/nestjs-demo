import type { Opt, Rel } from '@mikro-orm/core';
import { Entity, Enum, Index, OneToOne, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';

import { InventoryReservationStatus } from '~/api/inventory/domain/inventory.enum';
import { OrderItemEntity } from '~/api/order/domain/entity/order-item.entity';
import { isPositiveMysqlSignedInt } from '~/global/common/utils/mysql-number';

/**
 * 결제 대기 중 `ItemEntity.stock`에서 선차감한 수량의 생명주기를 나타낸다.
 * 생성과 차감은 한 트랜잭션에서 한 번 수행하고 CONSUMED는 추가 차감하지 않는다.
 * RELEASED 또는 EXPIRED는 재고를 정확히 한 번 복구하며 주문 품목당 하나만 존재한다.
 */
@Entity({ tableName: 'inventory_reservations' })
@Index({ name: 'inventory_reservations_status_expires_at_idx', properties: ['status', 'expiresAt'] })
export class InventoryReservationEntity {
    static reserve(orderItem: Rel<OrderItemEntity>, expiresAt: Date, now = new Date()): InventoryReservationEntity {
        if (orderItem.inventoryReservation) throw new Error('주문 품목에는 재고 예약을 하나만 만들 수 있습니다.');
        if (!isPositiveMysqlSignedInt(orderItem.quantity)) {
            throw new RangeError('재고 예약 수량은 1 이상 2147483647 이하의 정수여야 합니다.');
        }
        if (expiresAt.getTime() <= now.getTime()) throw new RangeError('재고 예약 만료 시각은 현재보다 뒤여야 합니다.');

        const reservation = new InventoryReservationEntity();
        reservation.orderItem = orderItem;
        reservation.quantity = orderItem.quantity;
        reservation.status = InventoryReservationStatus.RESERVED;
        reservation.expiresAt = expiresAt;
        orderItem.inventoryReservation = reservation;

        return reservation;
    }

    consume(now = new Date()): boolean {
        if (this.status === InventoryReservationStatus.CONSUMED) return false;
        if (this.status !== InventoryReservationStatus.RESERVED) {
            throw new Error(`${this.status} 재고 예약은 소비할 수 없습니다.`);
        }
        if (this.expiresAt.getTime() <= now.getTime()) throw new Error('만료된 재고 예약은 소비할 수 없습니다.');

        this.status = InventoryReservationStatus.CONSUMED;
        this.consumedAt = now;
        return true;
    }

    release(now = new Date()): boolean {
        return this.restore(InventoryReservationStatus.RELEASED, now);
    }

    returnAfterConsumption(now = new Date()): boolean {
        if (this.status === InventoryReservationStatus.RELEASED) return false;
        if (this.status !== InventoryReservationStatus.CONSUMED) {
            throw new Error(`${this.status} 재고 예약은 반품 복구할 수 없습니다.`);
        }

        this.status = InventoryReservationStatus.RELEASED;
        this.releasedAt = now;
        return true;
    }

    expire(now = new Date()): boolean {
        if (this.expiresAt.getTime() > now.getTime()) throw new Error('아직 만료되지 않은 재고 예약입니다.');
        return this.restore(InventoryReservationStatus.EXPIRED, now);
    }

    private restore(
        status: typeof InventoryReservationStatus.RELEASED | typeof InventoryReservationStatus.EXPIRED,
        now: Date
    ) {
        if (this.status === status) return false;
        if (this.status !== InventoryReservationStatus.RESERVED) {
            throw new Error(`${this.status} 재고 예약은 복구할 수 없습니다.`);
        }

        this.status = status;
        this.releasedAt = now;
        return true;
    }

    @PrimaryKey({ type: 'bigint', autoincrement: true, unsigned: false })
    id!: bigint;

    @Property({ columnType: 'int' })
    quantity!: number;

    /** 예약 생명주기의 현재값이며 `consumedAt` 및 `releasedAt`과 일치해야 한다. */
    @Enum({ items: () => InventoryReservationStatus, default: InventoryReservationStatus.RESERVED })
    status: InventoryReservationStatus & Opt = InventoryReservationStatus.RESERVED;

    @Property({ fieldName: 'expires_at', columnType: 'datetime(3)' })
    expiresAt!: Date;

    /** 재고를 확정 소비한 시각이며 CONSUMED 전환과 함께 기록한다. */
    @Property({ fieldName: 'consumed_at', columnType: 'datetime(3)', nullable: true })
    consumedAt: Date | null = null;

    /** 예약 재고를 복구한 시각이며 RELEASED 또는 EXPIRED 전환과 함께 기록한다. */
    @Property({ fieldName: 'released_at', columnType: 'datetime(3)', nullable: true })
    releasedAt: Date | null = null;

    @Property({ fieldName: 'created_at', columnType: 'datetime(3)', defaultRaw: 'CURRENT_TIMESTAMP(3)' })
    createdAt!: Date & Opt;

    @Property({
        fieldName: 'updated_at',
        columnType: 'datetime(3)',
        defaultRaw: 'CURRENT_TIMESTAMP(3)',
        onUpdate: () => new Date(),
    })
    updatedAt!: Date & Opt;

    @OneToOne(() => OrderItemEntity, (orderItem) => orderItem.inventoryReservation, {
        owner: true,
        joinColumn: 'order_item_id',
        unique: 'inventory_reservations_order_item_id_key',
        deleteRule: 'restrict',
        updateRule: 'cascade',
        foreignKeyName: 'inventory_reservations_order_item_id_fkey',
        unsigned: false,
        index: false,
    })
    orderItem!: Rel<OrderItemEntity>;
}
