import { EntityManager, type EntityRepository, LockMode } from '@mikro-orm/core';
import { Transactional } from '@mikro-orm/decorators/legacy';
import { InjectRepository } from '@mikro-orm/nestjs';
import {
    BadRequestException,
    ConflictException,
    ForbiddenException,
    Inject,
    Injectable,
    NotFoundException,
} from '@nestjs/common';

import { createHash } from 'node:crypto';
import type { InventoryTransitionResult } from '~/api/inventory/application/inventory-transition.result';
import type { InventoryMovementEntity } from '~/api/inventory/domain/inventory-movement.entity';
import { InventoryReservationEntity } from '~/api/inventory/domain/inventory-reservation.entity';
import { InventoryReservationStatus } from '~/api/inventory/domain/inventory.enum';
import { MemberRole } from '~/api/member/domain/member-role';
import { lockOrderDependents } from '~/api/order/application/order-dependents.lock';
import { ORDER_INVENTORY_PORT, type OrderInventoryPort } from '~/api/order/application/order-inventory.port';
import { OrderCancellationConflict, OrderEntity } from '~/api/order/domain/entity/order.entity';
import { OrderActorType, OrderStatus } from '~/api/order/domain/entity/order.enum';
import type { JwtPayload } from '~/global/jwt/payload/jwt.payload';

export interface OrderExpirationBatchResult {
    readonly selectedOrders: number;
    readonly expiredOrders: number;
    readonly failures: readonly {
        readonly orderId: string;
        readonly reservationId: string;
        readonly message: string;
    }[];
}

interface ExpirationActor {
    readonly type: OrderActorType;
    readonly id: string | null;
}

const MAX_EXPIRATION_BATCH_SIZE = 500;

/**
 * Cancels a PENDING order once every inventory reservation on it has expired.
 * The order aggregate decides whether expiration is allowed and records the transition; inventory
 * restores stock for each reservation through the port inside the same transaction.
 */
@Injectable()
export class OrderExpirationService {
    constructor(
        private readonly em: EntityManager,
        @InjectRepository(InventoryReservationEntity)
        private readonly reservationRepository: EntityRepository<InventoryReservationEntity>,
        @Inject(ORDER_INVENTORY_PORT)
        private readonly inventory: OrderInventoryPort
    ) {}

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

    async expireDueBatch(limit = 100, now = new Date()): Promise<OrderExpirationBatchResult> {
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
        actor: ExpirationActor,
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
                populate: [
                    'items.item',
                    'items.inventoryReservation',
                    'paymentAttempts',
                    'fulfillments',
                    'statusHistories',
                ],
                connectionType: 'write',
                lockMode: LockMode.PESSIMISTIC_WRITE,
                refresh: true,
            }
        );
        if (!order) throw new NotFoundException('주문을 찾을 수 없습니다.');
        await lockOrderDependents(this.em, order);

        const requested = order.inventoryReservations().find(({ id }) => id === reservationId);
        if (!requested) throw new NotFoundException('재고 예약을 찾을 수 없습니다.');
        const replayed = await this.inventory.findExpirationReplay(requested, idempotencyKey);
        if (replayed) {
            if (order.status === OrderStatus.CANCELLED && order.hasExpirationReplay(idempotencyKey)) {
                return { reservation: requested, movement: replayed };
            }
            throw new ConflictException('재고 만료 멱등성 키가 완료되지 않은 요청에 사용되었습니다.');
        }

        let expiration;
        try {
            expiration = order.expireReservations({
                actorType: actor.type,
                actorId: actor.id,
                requestId: idempotencyKey,
                occurredAt: now,
            });
        } catch (error: unknown) {
            if (error instanceof OrderCancellationConflict) throw new ConflictException(error.message);
            throw error;
        }

        let requestedMovement: InventoryMovementEntity | null = null;
        for (const reservation of expiration.reservations) {
            const movementKey =
                reservation.id === reservationId
                    ? idempotencyKey
                    : this.expirationMovementKey(order.id, reservation.id, idempotencyKey);
            const result = await this.inventory.restoreForExpiration(reservation, movementKey, now);
            if (reservation.id === reservationId) requestedMovement = result.movement;
        }

        if (expiration.history) this.em.persist(expiration.history);

        return { reservation: requested, movement: requestedMovement };
    }

    /** Derived keys keep the `expire:` sha256 form so ledgers written before this service still replay. */
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
