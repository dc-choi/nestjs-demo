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

import { createHash } from 'node:crypto';
import { ItemEntity } from '~/api/catalog/domain/entity/item.entity';
import { ProductEntity } from '~/api/catalog/domain/entity/product.entity';
import { InventoryMovementEntity } from '~/api/inventory/domain/inventory-movement.entity';
import { InventoryReservationEntity } from '~/api/inventory/domain/inventory-reservation.entity';
import { InventoryMovementType, InventoryReservationStatus } from '~/api/inventory/domain/inventory.enum';
import { MemberRole } from '~/api/member/domain/member-role';
import { OrderItemEntity } from '~/api/order/domain/entity/order-item.entity';
import { OrderEntity } from '~/api/order/domain/entity/order.entity';
import { OrderActorType, OrderStatus } from '~/api/order/domain/entity/order.enum';
import { PaymentAttemptStatus } from '~/api/payment/domain/payment.enum';
import { isMysqlSignedInt, isNonNegativeMysqlSignedInt } from '~/global/common/utils/mysql-number';
import type { JwtPayload } from '~/global/jwt/payload/jwt.payload';

export interface InventoryTransitionResult {
    readonly reservation: InventoryReservationEntity;
    readonly movement: InventoryMovementEntity | null;
}

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

export interface InventoryExpirationBatchResult {
    readonly selectedOrders: number;
    readonly expiredOrders: number;
    readonly failures: readonly {
        readonly orderId: string;
        readonly reservationId: string;
        readonly message: string;
    }[];
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
const CANCELLABLE_PAYMENT_STATUSES: readonly PaymentAttemptStatus[] = [
    PaymentAttemptStatus.PENDING,
    PaymentAttemptStatus.REQUIRES_ACTION,
];
const TERMINAL_PAYMENT_STATUSES: readonly PaymentAttemptStatus[] = [
    PaymentAttemptStatus.CANCELLED,
    PaymentAttemptStatus.FAILED,
];
const MAX_EXPIRATION_BATCH_SIZE = 500;

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

    @Transactional()
    async consume(jwtPayload: JwtPayload, reservationId: bigint, now = new Date()): Promise<InventoryTransitionResult> {
        const reservation = await this.findReservationForUpdate(reservationId);
        this.assertOwnerOrAdmin(jwtPayload, reservation);
        if (this.assertConsumable(reservation, now)) reservation.consume(now);

        return { reservation, movement: null };
    }

    consumeForPayment(reservation: InventoryReservationEntity, now = new Date()): void {
        if (this.assertConsumable(reservation, now)) reservation.consume(now);
    }

    async releaseForCancellation(
        reservation: InventoryReservationEntity,
        idempotencyKey: string,
        now = new Date()
    ): Promise<InventoryTransitionResult | null> {
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
        if (locked.reservation.orderItem.order.status !== 'CANCELLED') {
            throw new ConflictException('주문 취소 전에 재고 예약만 개별 해제할 수 없습니다.');
        }

        return this.restore(locked.reservation, locked.item, InventoryReservationStatus.RELEASED, idempotencyKey, now);
    }

    async expire(
        jwtPayload: JwtPayload,
        reservationId: bigint,
        idempotencyKey: string,
        now = new Date()
    ): Promise<InventoryTransitionResult> {
        if (jwtPayload.role !== MemberRole.ADMIN) throw new ForbiddenException('재고 예약 만료 권한이 없습니다.');
        this.assertIdempotencyKey(idempotencyKey);

        return this.expireOrderByReservation(
            reservationId,
            idempotencyKey,
            { type: OrderActorType.MEMBER, id: jwtPayload.memberId.toString() },
            now
        );
    }

    async expireDueBatch(limit = 100, now = new Date()): Promise<InventoryExpirationBatchResult> {
        if (!Number.isInteger(limit) || limit < 1 || limit > MAX_EXPIRATION_BATCH_SIZE) {
            throw new BadRequestException(`재고 만료 배치 크기는 1 이상 ${MAX_EXPIRATION_BATCH_SIZE} 이하여야 합니다.`);
        }

        const candidates = await this.em.fork({ useContext: false }).find(
            InventoryReservationEntity,
            {
                status: InventoryReservationStatus.RESERVED,
                expiresAt: { $lte: now },
                orderItem: { order: { status: OrderStatus.PENDING, deletedAt: null } },
            },
            {
                populate: ['orderItem.order'],
                orderBy: { expiresAt: 'asc', id: 'asc' },
                limit,
                connectionType: 'write',
            }
        );
        const firstReservationByOrder = new Map<bigint, InventoryReservationEntity>();
        for (const reservation of candidates) {
            const { order } = reservation.orderItem;
            if (!firstReservationByOrder.has(order.id)) firstReservationByOrder.set(order.id, reservation);
        }

        let expiredOrders = 0;
        const failures: { orderId: string; reservationId: string; message: string }[] = [];
        for (const [orderId, reservation] of firstReservationByOrder) {
            try {
                await this.expireOrderByReservation(
                    reservation.id,
                    this.expirationBatchKey(orderId),
                    { type: OrderActorType.SYSTEM, id: null },
                    now
                );
                expiredOrders += 1;
            } catch (error: unknown) {
                if (!(error instanceof ConflictException) && !(error instanceof NotFoundException)) throw error;
                failures.push({
                    orderId: orderId.toString(),
                    reservationId: reservation.id.toString(),
                    message: error.message,
                });
            }
        }

        return { selectedOrders: firstReservationByOrder.size, expiredOrders, failures };
    }

    @Transactional()
    private async expireOrderByReservation(
        reservationId: bigint,
        idempotencyKey: string,
        actor: { readonly type: OrderActorType; readonly id: string | null },
        now: Date
    ): Promise<InventoryTransitionResult> {
        const discovered = await this.reservationRepository.findOne(
            { id: reservationId },
            { populate: ['orderItem.order'], connectionType: 'write' }
        );
        if (!discovered) throw new NotFoundException('재고 예약을 찾을 수 없습니다.');

        const order = await this.em.findOne(
            OrderEntity,
            { id: discovered.orderItem.order.id, deletedAt: null },
            {
                populate: ['items.item', 'items.inventoryReservation', 'paymentAttempts', 'statusHistories'],
                connectionType: 'write',
                lockMode: LockMode.PESSIMISTIC_WRITE,
                refresh: true,
            }
        );
        if (!order) throw new NotFoundException('주문을 찾을 수 없습니다.');

        const attempts = order.paymentAttempts.getItems().toSorted((left, right) => compareBigInt(left.id, right.id));
        for (const attempt of attempts) await this.em.lock(attempt, LockMode.PESSIMISTIC_WRITE);

        const items = [
            ...new Map(order.items.getItems().map(({ item }) => [item.id, item] as const)).values(),
        ].toSorted((left, right) => compareBigInt(left.id, right.id));
        for (const item of items) {
            await this.em.refresh(item, { connectionType: 'write', lockMode: LockMode.PESSIMISTIC_WRITE });
        }
        const itemsById = new Map(items.map((item) => [item.id, item] as const));

        const reservations = order.items
            .getItems()
            .flatMap(({ inventoryReservation }) => (inventoryReservation ? [inventoryReservation] : []))
            .toSorted((left, right) => compareBigInt(left.id, right.id));
        for (const reservation of reservations) {
            await this.em.lock(reservation, LockMode.PESSIMISTIC_WRITE);
            reservation.orderItem.item = itemsById.get(reservation.orderItem.item.id)!;
        }

        const requested = reservations.find(({ id }) => id === reservationId);
        if (!requested) throw new NotFoundException('재고 예약을 찾을 수 없습니다.');
        const duplicate = await this.movementRepository.findOne(
            { item: requested.orderItem.item.id, idempotencyKey },
            { connectionType: 'write' }
        );
        if (duplicate) {
            this.assertSameRestore(duplicate, requested, InventoryReservationStatus.EXPIRED);
            const replay = order.statusHistories
                .getItems()
                .some(
                    ({ toStatus, requestId, reason }) =>
                        toStatus === OrderStatus.CANCELLED &&
                        requestId === idempotencyKey &&
                        reason === 'INVENTORY_RESERVATION_EXPIRED'
                );
            if (order.status === OrderStatus.CANCELLED && replay)
                return { reservation: requested, movement: duplicate };
            throw new ConflictException('재고 만료 멱등성 키가 완료되지 않은 요청에 사용되었습니다.');
        }
        if (order.status !== OrderStatus.PENDING) {
            throw new ConflictException('결제 대기 주문의 재고 예약만 만료할 수 있습니다.');
        }
        if (reservations.length !== order.items.length) {
            throw new ConflictException('모든 주문 품목에 재고 예약이 있어야 합니다.');
        }
        if (
            reservations.some(
                ({ status }) =>
                    status !== InventoryReservationStatus.RESERVED && status !== InventoryReservationStatus.EXPIRED
            )
        ) {
            throw new ConflictException('소비되거나 해제된 재고 예약이 있는 주문은 만료할 수 없습니다.');
        }
        const active = reservations.filter(({ status }) => status === InventoryReservationStatus.RESERVED);
        if (active.length === 0) throw new ConflictException('이미 다른 요청으로 만료된 주문입니다.');
        if (active.some(({ expiresAt }) => expiresAt.getTime() > now.getTime())) {
            throw new ConflictException('아직 만료되지 않은 재고 예약이 있는 주문입니다.');
        }
        if (
            attempts.some(
                ({ status }) =>
                    !CANCELLABLE_PAYMENT_STATUSES.includes(status) && !TERMINAL_PAYMENT_STATUSES.includes(status)
            )
        ) {
            throw new ConflictException('취소할 수 없는 결제 시도가 있는 주문은 만료할 수 없습니다.');
        }

        for (const attempt of attempts) {
            if (CANCELLABLE_PAYMENT_STATUSES.includes(attempt.status)) attempt.cancel(now);
        }

        let requestedMovement: InventoryMovementEntity | null = null;
        for (const reservation of active) {
            const movementKey =
                reservation.id === reservationId
                    ? idempotencyKey
                    : this.expirationMovementKey(order.id, reservation.id, idempotencyKey);
            const result = await this.restore(
                reservation,
                reservation.orderItem.item,
                InventoryReservationStatus.EXPIRED,
                movementKey,
                now
            );
            if (reservation.id === reservationId) requestedMovement = result.movement;
        }

        const history = order.transition({
            to: OrderStatus.CANCELLED,
            actorType: actor.type,
            actorId: actor.id,
            reason: 'INVENTORY_RESERVATION_EXPIRED',
            requestId: idempotencyKey,
            occurredAt: now,
        });
        if (history) this.em.persist(history);

        return { reservation: requested, movement: requestedMovement };
    }

    private async findReservationForUpdate(id: bigint): Promise<InventoryReservationEntity> {
        const discovered = await this.reservationRepository.findOne(
            { id },
            { populate: ['orderItem.order'], connectionType: 'write' }
        );
        if (!discovered) throw new NotFoundException('재고 예약을 찾을 수 없습니다.');

        const order = await this.em.findOne(
            OrderEntity,
            { id: discovered.orderItem.order.id, deletedAt: null },
            {
                populate: ['member'],
                connectionType: 'write',
                lockMode: LockMode.PESSIMISTIC_WRITE,
                refresh: true,
            }
        );
        if (!order) throw new NotFoundException('주문을 찾을 수 없습니다.');

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
        reservation.orderItem.order = order;

        return reservation;
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

    private assertOwnerOrAdmin(jwtPayload: JwtPayload, reservation: InventoryReservationEntity): void {
        if (jwtPayload.role === MemberRole.ADMIN) return;
        if (reservation.orderItem.order.member.id !== jwtPayload.memberId) {
            throw new ForbiddenException('다른 회원의 재고 예약을 변경할 수 없습니다.');
        }
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

    private expirationMovementKey(orderId: bigint, reservationId: bigint, idempotencyKey: string): string {
        const digest = createHash('sha256').update(`${orderId}:${reservationId}:${idempotencyKey}`).digest('hex');
        return `expire:${digest}`;
    }

    private expirationBatchKey(orderId: bigint): string {
        const digest = createHash('sha256').update(orderId.toString()).digest('hex');
        return `expire:${digest}`;
    }

    private assertIdempotencyKey(value: string): void {
        if (value.trim().length === 0 || value.length > 128) {
            throw new BadRequestException('재고 멱등성 키는 1자 이상 128자 이하여야 합니다.');
        }
    }
}

function compareBigInt(left: bigint, right: bigint): number {
    return left < right ? -1 : left > right ? 1 : 0;
}
