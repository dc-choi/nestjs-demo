import { EntityManager, type EntityRepository, LockMode } from '@mikro-orm/core';
import { Transactional } from '@mikro-orm/decorators/legacy';
import { InjectRepository } from '@mikro-orm/nestjs';
import {
    BadRequestException,
    ConflictException,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';

import { ItemEntity } from '~/api/catalog/domain/entity/item.entity';
import { ProductEntity } from '~/api/catalog/domain/entity/product.entity';
import type { InventoryTransitionResult } from '~/api/inventory/application/inventory-transition.result';
import { InventoryMovementEntity } from '~/api/inventory/domain/inventory-movement.entity';
import { InventoryReservationEntity } from '~/api/inventory/domain/inventory-reservation.entity';
import { InventoryMovementType, InventoryReservationStatus } from '~/api/inventory/domain/inventory.enum';
import { MemberRole } from '~/api/member/domain/member-role';
import { OrderItemEntity } from '~/api/order/domain/entity/order-item.entity';
import { OrderStatus } from '~/api/order/domain/entity/order.enum';
import { compareBigInt } from '~/global/common/utils/bigint';
import { isMysqlSignedInt, isNonNegativeMysqlSignedInt } from '~/global/common/utils/mysql-number';
import type { JwtPayload } from '~/global/jwt/payload/jwt.payload';

export interface PlacementReservationLine {
    readonly orderItem: OrderItemEntity;
    readonly idempotencyKey: string;
}

export interface AdjustInventoryCommand {
    readonly itemId: bigint;
    readonly type:
        | typeof InventoryMovementType.RECEIPT
        | typeof InventoryMovementType.ADJUSTMENT
        | typeof InventoryMovementType.RETURN;
    readonly quantityDelta: number;
    readonly reason: string;
    readonly idempotencyKey: string;
}

const ADJUSTMENT_TYPES: readonly InventoryMovementType[] = [
    InventoryMovementType.RECEIPT,
    InventoryMovementType.ADJUSTMENT,
    InventoryMovementType.RETURN,
];
const POSITIVE_ADJUSTMENT_TYPES: readonly InventoryMovementType[] = [
    InventoryMovementType.RECEIPT,
    InventoryMovementType.RETURN,
];
const INVENTORY_OPERATOR_ROLES: readonly MemberRole[] = [MemberRole.ADMIN, MemberRole.SELLER];

@Injectable()
export class InventoryService {
    constructor(
        private readonly em: EntityManager,
        @InjectRepository(ItemEntity)
        private readonly itemRepository: EntityRepository<ItemEntity>,
        @InjectRepository(InventoryReservationEntity)
        private readonly reservationRepository: EntityRepository<InventoryReservationEntity>,
        @InjectRepository(InventoryMovementEntity)
        private readonly movementRepository: EntityRepository<InventoryMovementEntity>
    ) {}

    async reserveForPlacement(
        orderItem: OrderItemEntity,
        expiresAt: Date,
        idempotencyKey: string,
        orderNumber: string,
        now = new Date()
    ): Promise<InventoryTransitionResult> {
        const [result] = await this.reserveForPlacementBatch(
            [{ orderItem, idempotencyKey }],
            expiresAt,
            orderNumber,
            now
        );
        return result;
    }

    async reserveForPlacementBatch(
        lines: readonly PlacementReservationLine[],
        expiresAt: Date,
        orderNumber: string,
        now = new Date()
    ): Promise<InventoryTransitionResult[]> {
        this.assertTransaction();
        if (lines.length === 0) throw new BadRequestException('재고 예약 품목은 하나 이상이어야 합니다.');
        if (expiresAt.getTime() <= now.getTime()) {
            throw new BadRequestException('재고 예약 만료 시각은 현재보다 뒤여야 합니다.');
        }
        if (new Set(lines.map(({ idempotencyKey }) => idempotencyKey)).size !== lines.length) {
            throw new ConflictException('한 주문에서 재고 멱등성 키를 중복할 수 없습니다.');
        }
        for (const { idempotencyKey } of lines) this.assertIdempotencyKey(idempotencyKey);

        const items = [
            ...new Map(lines.map(({ orderItem }) => [orderItem.item.id, orderItem.item] as const)).values(),
        ].toSorted((left, right) => compareBigInt(left.id, right.id));
        for (const item of items) {
            const refreshed = await this.em.refresh(item, {
                connectionType: 'write',
                lockMode: LockMode.PESSIMISTIC_WRITE,
            });
            if (!refreshed || item.deletedAt != null) throw new NotFoundException('품목을 찾을 수 없습니다.');
        }

        for (const { orderItem, idempotencyKey } of lines) {
            const duplicate = await this.movementRepository.findOne(
                { item: orderItem.item.id, idempotencyKey },
                { connectionType: 'write' }
            );
            if (duplicate) throw new ConflictException('이미 사용된 재고 멱등성 키입니다.');
        }

        const requiredByItem = new Map<bigint, number>();
        for (const { orderItem } of lines) {
            requiredByItem.set(orderItem.item.id, (requiredByItem.get(orderItem.item.id) ?? 0) + orderItem.quantity);
        }
        if (items.some((item) => item.stock < requiredByItem.get(item.id)!)) {
            throw new BadRequestException('재고가 부족합니다.');
        }

        return lines.map(({ orderItem, idempotencyKey }) => {
            const { item, quantity } = orderItem;
            item.stock -= quantity;
            item.updatedAt = now;
            const reservation = InventoryReservationEntity.reserve(orderItem, expiresAt, now);
            const movement = InventoryMovementEntity.record({
                item,
                type: InventoryMovementType.RESERVATION,
                quantityDelta: -quantity,
                stockAfter: item.stock,
                idempotencyKey,
                referenceType: 'ORDER',
                referenceId: orderNumber,
            });
            this.em.persist([reservation, movement]);
            return { reservation, movement };
        });
    }

    @Transactional()
    async adjust(
        jwtPayload: JwtPayload,
        command: AdjustInventoryCommand,
        now = new Date()
    ): Promise<InventoryMovementEntity> {
        if (!INVENTORY_OPERATOR_ROLES.includes(jwtPayload.role)) {
            throw new ForbiddenException('재고 조정 권한이 없습니다.');
        }
        this.assertIdempotencyKey(command.idempotencyKey);
        if (!ADJUSTMENT_TYPES.includes(command.type))
            throw new BadRequestException('허용되지 않은 재고 원장 유형입니다.');
        if (!isMysqlSignedInt(command.quantityDelta) || command.quantityDelta === 0) {
            throw new BadRequestException(
                '재고 조정 수량은 -2147483648 이상 2147483647 이하의 0이 아닌 정수여야 합니다.'
            );
        }
        if (command.reason.trim().length === 0 || command.reason.length > 255) {
            throw new BadRequestException('재고 조정 사유는 1자 이상 255자 이하여야 합니다.');
        }
        if (POSITIVE_ADJUSTMENT_TYPES.includes(command.type) && command.quantityDelta < 1) {
            throw new BadRequestException('입고와 반품 수량은 양수여야 합니다.');
        }

        const discovered = await this.itemRepository.findOne(
            { id: command.itemId, deletedAt: null },
            {
                populate: ['product'],
                connectionType: 'write',
            }
        );
        if (!discovered) throw new NotFoundException('품목을 찾을 수 없습니다.');

        const product = await this.em.findOne(
            ProductEntity,
            { id: discovered.product.id, deletedAt: null },
            {
                populate: ['seller'],
                connectionType: 'write',
                lockMode: LockMode.PESSIMISTIC_WRITE,
                refresh: true,
            }
        );
        if (!product) throw new NotFoundException('품목을 찾을 수 없습니다.');
        if (jwtPayload.role === MemberRole.SELLER && product.seller.id !== jwtPayload.memberId) {
            throw new ForbiddenException('다른 판매자의 품목 재고를 조정할 수 없습니다.');
        }

        const item = await this.itemRepository.findOne(
            { id: command.itemId, product: product.id, deletedAt: null },
            {
                connectionType: 'write',
                lockMode: LockMode.PESSIMISTIC_WRITE,
                refresh: true,
            }
        );
        if (!item) throw new NotFoundException('품목을 찾을 수 없습니다.');

        const duplicate = await this.movementRepository.findOne(
            { item: item.id, idempotencyKey: command.idempotencyKey },
            { connectionType: 'write' }
        );
        if (duplicate) {
            this.assertSameAdjustment(duplicate, command);
            return duplicate;
        }

        const stockAfter = item.stock + command.quantityDelta;
        if (!isNonNegativeMysqlSignedInt(stockAfter)) {
            throw new BadRequestException('재고 조정 후 수량은 0 이상 2147483647 이하의 정수여야 합니다.');
        }

        item.stock = stockAfter;
        item.updatedAt = now;
        const movement = InventoryMovementEntity.record({
            item,
            type: command.type,
            quantityDelta: command.quantityDelta,
            stockAfter,
            idempotencyKey: command.idempotencyKey,
            reason: command.reason,
        });
        this.em.persist(movement);
        return movement;
    }

    consumeForPayment(reservation: InventoryReservationEntity, now = new Date()): void {
        this.assertTransaction();
        if (this.assertConsumable(reservation, now)) reservation.consume(now);
    }

    async releaseForCancellation(
        reservation: InventoryReservationEntity,
        idempotencyKey: string,
        now = new Date()
    ): Promise<InventoryTransitionResult | null> {
        this.assertTransaction();
        this.assertIdempotencyKey(idempotencyKey);
        const item = reservation.orderItem.item;
        await this.em.lock(item, LockMode.PESSIMISTIC_WRITE);
        await this.em.lock(reservation, LockMode.PESSIMISTIC_WRITE);
        if (
            reservation.status !== InventoryReservationStatus.RESERVED &&
            reservation.status !== InventoryReservationStatus.CONSUMED
        ) {
            return null;
        }
        if (reservation.status === InventoryReservationStatus.CONSUMED) {
            return this.restoreConsumedForCancellation(reservation, item, idempotencyKey, now);
        }
        return this.restore(reservation, item, InventoryReservationStatus.RELEASED, idempotencyKey, now);
    }

    async findExpirationReplay(
        reservation: InventoryReservationEntity,
        idempotencyKey: string
    ): Promise<InventoryMovementEntity | null> {
        this.assertTransaction();
        const duplicate = await this.movementRepository.findOne(
            { item: reservation.orderItem.item.id, idempotencyKey },
            { connectionType: 'write' }
        );
        if (duplicate) this.assertSameRestore(duplicate, reservation, InventoryReservationStatus.EXPIRED);
        return duplicate;
    }

    async restoreForExpiration(
        reservation: InventoryReservationEntity,
        idempotencyKey: string,
        now = new Date()
    ): Promise<InventoryTransitionResult> {
        this.assertTransaction();
        this.assertIdempotencyKey(idempotencyKey);
        const item = reservation.orderItem.item;
        await this.em.lock(item, LockMode.PESSIMISTIC_WRITE);
        await this.em.lock(reservation, LockMode.PESSIMISTIC_WRITE);
        return this.restore(reservation, item, InventoryReservationStatus.EXPIRED, idempotencyKey, now);
    }

    @Transactional()
    async release(
        jwtPayload: JwtPayload,
        reservationId: bigint,
        idempotencyKey: string,
        now = new Date()
    ): Promise<InventoryTransitionResult> {
        if (jwtPayload.role !== MemberRole.ADMIN) {
            throw new ForbiddenException('재고 예약 개별 해제 권한이 없습니다. 주문 취소를 이용하세요.');
        }
        this.assertIdempotencyKey(idempotencyKey);
        const locked = await this.findReservationAndItemForUpdate(reservationId);
        if (locked.reservation.orderItem.order.status !== OrderStatus.CANCELLED) {
            throw new ConflictException('주문 취소 전에 재고 예약만 개별 해제할 수 없습니다.');
        }

        return this.restore(locked.reservation, locked.item, InventoryReservationStatus.RELEASED, idempotencyKey, now);
    }

    private async findReservationAndItemForUpdate(
        id: bigint
    ): Promise<{ reservation: InventoryReservationEntity; item: ItemEntity }> {
        const discovered = await this.reservationRepository.findOne(
            { id },
            {
                populate: ['orderItem.item', 'orderItem.order.member'],
                connectionType: 'write',
            }
        );
        if (!discovered) throw new NotFoundException('재고 예약을 찾을 수 없습니다.');

        const item = await this.findItemForUpdate(discovered.orderItem.item.id, true);
        const reservation = await this.reservationRepository.findOne(
            { id },
            {
                populate: ['orderItem.item', 'orderItem.order.member'],
                connectionType: 'write',
                lockMode: LockMode.PESSIMISTIC_WRITE,
                refresh: true,
            }
        );
        if (!reservation) throw new NotFoundException('재고 예약을 찾을 수 없습니다.');
        reservation.orderItem.item = item;
        return { reservation, item };
    }

    private async findItemForUpdate(id: bigint, includeDeleted: boolean): Promise<ItemEntity> {
        const item = await this.itemRepository.findOne(includeDeleted ? { id } : { id, deletedAt: null }, {
            connectionType: 'write',
            lockMode: LockMode.PESSIMISTIC_WRITE,
            refresh: true,
        });
        if (!item) throw new NotFoundException('품목을 찾을 수 없습니다.');
        return item;
    }

    private async restore(
        reservation: InventoryReservationEntity,
        item: ItemEntity,
        status: typeof InventoryReservationStatus.RELEASED | typeof InventoryReservationStatus.EXPIRED,
        idempotencyKey: string,
        now: Date
    ): Promise<InventoryTransitionResult> {
        const duplicate = await this.movementRepository.findOne(
            { item: item.id, idempotencyKey },
            { connectionType: 'write' }
        );
        if (duplicate) {
            this.assertSameRestore(duplicate, reservation, status);
            return { reservation, movement: duplicate };
        }

        if (reservation.status !== InventoryReservationStatus.RESERVED) {
            throw new ConflictException(`${reservation.status} 재고 예약은 복구할 수 없습니다.`);
        }
        if (status === InventoryReservationStatus.EXPIRED && reservation.expiresAt.getTime() > now.getTime()) {
            throw new ConflictException('아직 만료되지 않은 재고 예약입니다.');
        }

        const stockAfter = this.restoredStock(item, reservation.quantity);
        const changed =
            status === InventoryReservationStatus.EXPIRED ? reservation.expire(now) : reservation.release(now);
        if (!changed) throw new ConflictException('복구 원장이 없는 종료된 재고 예약입니다.');

        item.stock = stockAfter;
        item.updatedAt = now;
        const movement = InventoryMovementEntity.record({
            item,
            type: InventoryMovementType.RELEASE,
            quantityDelta: reservation.quantity,
            stockAfter,
            idempotencyKey,
            referenceType: 'INVENTORY_RESERVATION',
            referenceId: reservation.id.toString(),
            reason: status,
        });
        this.em.persist(movement);

        return { reservation, movement };
    }

    private async restoreConsumedForCancellation(
        reservation: InventoryReservationEntity,
        item: ItemEntity,
        idempotencyKey: string,
        now: Date
    ): Promise<InventoryTransitionResult> {
        const duplicate = await this.movementRepository.findOne(
            { item: item.id, idempotencyKey },
            { connectionType: 'write' }
        );
        if (duplicate) {
            const matches =
                duplicate.type === InventoryMovementType.RETURN &&
                duplicate.quantityDelta === reservation.quantity &&
                duplicate.referenceType === 'INVENTORY_RESERVATION' &&
                duplicate.referenceId === reservation.id.toString() &&
                duplicate.reason === 'ORDER_CANCELLED_AFTER_REFUND' &&
                reservation.status === InventoryReservationStatus.RELEASED;
            if (!matches) throw new ConflictException('재고 멱등성 키가 다른 요청에 사용되었습니다.');
            return { reservation, movement: duplicate };
        }

        const stockAfter = this.restoredStock(item, reservation.quantity);
        reservation.returnAfterConsumption(now);
        item.stock = stockAfter;
        item.updatedAt = now;
        const movement = InventoryMovementEntity.record({
            item,
            type: InventoryMovementType.RETURN,
            quantityDelta: reservation.quantity,
            stockAfter,
            idempotencyKey,
            referenceType: 'INVENTORY_RESERVATION',
            referenceId: reservation.id.toString(),
            reason: 'ORDER_CANCELLED_AFTER_REFUND',
        });
        this.em.persist(movement);
        return { reservation, movement };
    }

    private assertSameRestore(
        movement: InventoryMovementEntity,
        reservation: InventoryReservationEntity,
        expectedStatus: typeof InventoryReservationStatus.RELEASED | typeof InventoryReservationStatus.EXPIRED
    ): void {
        const matches =
            movement.type === InventoryMovementType.RELEASE &&
            movement.quantityDelta === reservation.quantity &&
            movement.referenceType === 'INVENTORY_RESERVATION' &&
            movement.referenceId === reservation.id.toString() &&
            movement.reason === expectedStatus &&
            reservation.status === expectedStatus;
        if (!matches) throw new ConflictException('재고 멱등성 키가 다른 요청에 사용되었습니다.');
    }

    private restoredStock(item: ItemEntity, quantity: number): number {
        const stockAfter = item.stock + quantity;
        if (!isNonNegativeMysqlSignedInt(stockAfter)) {
            throw new ConflictException('재고 복구 후 수량은 0 이상 2147483647 이하여야 합니다.');
        }
        return stockAfter;
    }

    private assertSameAdjustment(movement: InventoryMovementEntity, command: AdjustInventoryCommand): void {
        const matches =
            movement.type === command.type &&
            movement.quantityDelta === command.quantityDelta &&
            movement.reason === command.reason &&
            movement.referenceType == null &&
            movement.referenceId == null;
        if (!matches) throw new ConflictException('재고 멱등성 키가 다른 요청에 사용되었습니다.');
    }

    private assertTransaction(): void {
        if (!this.em.isInTransaction()) throw new Error('Inventory transitions require the caller transaction');
    }

    private assertConsumable(reservation: InventoryReservationEntity, now: Date): boolean {
        if (reservation.status === InventoryReservationStatus.CONSUMED) return false;
        if (reservation.status !== InventoryReservationStatus.RESERVED) {
            throw new ConflictException(`${reservation.status} 재고 예약은 소비할 수 없습니다.`);
        }
        if (reservation.expiresAt.getTime() <= now.getTime()) {
            throw new ConflictException('만료된 재고 예약은 소비할 수 없습니다.');
        }
        return true;
    }

    private assertIdempotencyKey(value: string): void {
        if (value.trim().length === 0 || value.length > 128) {
            throw new BadRequestException('재고 멱등성 키는 1자 이상 128자 이하여야 합니다.');
        }
    }
}
