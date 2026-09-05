import { EntityManager, type EntityRepository, LockMode, UniqueConstraintViolationException } from '@mikro-orm/core';
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

import { createHash, randomUUIDv7 } from 'node:crypto';
import { ItemSaleStatus } from '~/api/catalog/domain/entity/item-sale-status';
import { ItemEntity } from '~/api/catalog/domain/entity/item.entity';
import { ProductStatus } from '~/api/catalog/domain/entity/product-status';
import { ProductEntity } from '~/api/catalog/domain/entity/product.entity';
import { MemberRole } from '~/api/member/domain/member-role';
import { MemberEntity } from '~/api/member/domain/member.entity';
import type { CancelOrderCommand } from '~/api/order/application/cancel-order.command';
import { ORDER_INVENTORY_PORT, type OrderInventoryPort } from '~/api/order/application/order-inventory.port';
import type { PlaceOrderCommand } from '~/api/order/application/place-order.command';
import { OrderItemEntity } from '~/api/order/domain/entity/order-item.entity';
import { OrderCancellationConflict, OrderEntity } from '~/api/order/domain/entity/order.entity';
import { NotExistingItem } from '~/global/common/error/item.error';
import { DistributedLockOptions, DistributedLockService } from '~/global/common/lock/distributed-lock.service';
import { isPositiveMysqlSignedInt } from '~/global/common/utils/mysql-number';
import type { JwtPayload } from '~/global/jwt/payload/jwt.payload';

const ORDER_LOCK_OPTIONS: DistributedLockOptions = {
    ttl: 30_000,
    maxRetries: 3,
    baseDelay: 100,
};
const RESERVATION_TTL_MS = 15 * 60 * 1000;

@Injectable()
export class OrderService {
    constructor(
        private readonly em: EntityManager,
        @InjectRepository(ItemEntity)
        private readonly itemRepository: EntityRepository<ItemEntity>,
        @InjectRepository(MemberEntity)
        private readonly memberRepository: EntityRepository<MemberEntity>,
        @InjectRepository(OrderEntity)
        private readonly orderRepository: EntityRepository<OrderEntity>,
        @Inject(ORDER_INVENTORY_PORT)
        private readonly inventory: OrderInventoryPort,
        private readonly distributedLock: DistributedLockService
    ) {}

    async order(jwtPayload: JwtPayload, command: PlaceOrderCommand): Promise<OrderEntity> {
        this.assertPlaceOrderIdempotencyKey(command.idempotencyKey);
        this.assertPlaceOrderItems(command);
        const requestFingerprint = this.placeOrderFingerprint(command);
        const replay = await this.findIdempotentOrder(jwtPayload.memberId, command.idempotencyKey);
        if (replay) return this.assertSamePlaceOrder(replay, requestFingerprint);

        const idempotencyLockDigest = createHash('sha256')
            .update(`${jwtPayload.memberId}:${command.idempotencyKey}`)
            .digest('hex');
        const lockKeys = [
            `lock:order:idempotency:${idempotencyLockDigest}`,
            ...[...new Set(command.items.map(({ itemId }) => itemId))]
                .sort(compareBigInt)
                .map((itemId) => `lock:item:${itemId}`),
        ];

        try {
            return await this.distributedLock.run(
                lockKeys,
                () => this.createOrder(jwtPayload, command, requestFingerprint),
                ORDER_LOCK_OPTIONS
            );
        } catch (error: unknown) {
            if (!(error instanceof UniqueConstraintViolationException)) throw error;

            const concurrentReplay = await this.findIdempotentOrder(jwtPayload.memberId, command.idempotencyKey);
            if (!concurrentReplay) throw error;
            return this.assertSamePlaceOrder(concurrentReplay, requestFingerprint);
        }
    }

    @Transactional()
    async cancel(jwtPayload: JwtPayload, command: CancelOrderCommand, now = new Date()): Promise<OrderEntity> {
        if (command.idempotencyKey.trim().length === 0 || command.idempotencyKey.length > 128) {
            throw new BadRequestException('주문 취소 멱등성 키는 1자 이상 128자 이하여야 합니다.');
        }
        if (command.reason != null && (command.reason.trim().length === 0 || command.reason.length > 255)) {
            throw new BadRequestException('주문 취소 사유는 1자 이상 255자 이하여야 합니다.');
        }

        const order = await this.orderRepository.findOne(
            { id: command.orderId, deletedAt: null },
            {
                populate: [
                    'member',
                    'items.item',
                    'items.snapshot',
                    'items.inventoryReservation',
                    'paymentAttempts.transactions',
                    'fulfillments',
                    'statusHistories',
                ],
                connectionType: 'write',
                lockMode: LockMode.PESSIMISTIC_WRITE,
            }
        );
        if (!order) throw new NotFoundException('주문을 찾을 수 없습니다.');
        this.assertOrderOwnerOrAdmin(jwtPayload, order);
        await this.lockCancellationDependents(order);

        const reason = command.reason ?? 'CUSTOMER_REQUEST';
        let cancellation;
        try {
            cancellation = order.cancelByMember({
                actorId: jwtPayload.memberId.toString(),
                reason,
                requestId: command.idempotencyKey,
                occurredAt: now,
            });
        } catch (error: unknown) {
            if (error instanceof OrderCancellationConflict) throw new ConflictException(error.message);
            throw error;
        }
        if (cancellation.isReplay) return order;

        for (const reservation of cancellation.reservations) {
            await this.inventory.releaseForCancellation(
                reservation,
                this.cancellationMovementKey(order.id, reservation.id, command.idempotencyKey),
                now
            );
        }
        if (cancellation.history) this.em.persist(cancellation.history);
        return order;
    }

    private async lockCancellationDependents(order: OrderEntity): Promise<void> {
        const attempts = order.paymentAttempts.getItems().toSorted((left, right) => compareBigInt(left.id, right.id));
        for (const attempt of attempts) await this.em.lock(attempt, LockMode.PESSIMISTIC_WRITE);

        const items = [
            ...new Map(order.items.getItems().map(({ item }) => [item.id, item] as const)).values(),
        ].toSorted((left, right) => compareBigInt(left.id, right.id));
        for (const item of items) {
            await this.em.refresh(item, {
                connectionType: 'write',
                lockMode: LockMode.PESSIMISTIC_WRITE,
            });
        }

        const reservations = order.items
            .getItems()
            .flatMap(({ inventoryReservation }) => (inventoryReservation ? [inventoryReservation] : []))
            .toSorted((left, right) => compareBigInt(left.id, right.id));
        for (const reservation of reservations) await this.em.lock(reservation, LockMode.PESSIMISTIC_WRITE);

        const fulfillments = order.fulfillments.getItems().toSorted((left, right) => compareBigInt(left.id, right.id));
        for (const fulfillment of fulfillments) await this.em.lock(fulfillment, LockMode.PESSIMISTIC_WRITE);
    }

    @Transactional()
    private async createOrder(
        jwtPayload: JwtPayload,
        command: PlaceOrderCommand,
        requestFingerprint: string
    ): Promise<OrderEntity> {
        const { memberId } = jwtPayload;
        const replay = await this.findIdempotentOrder(memberId, command.idempotencyKey);
        if (replay) return this.assertSamePlaceOrder(replay, requestFingerprint);

        const orderItems: OrderItemEntity[] = [];
        const orderNumber = randomUUIDv7();
        const placedAt = new Date();
        const reservationExpiresAt = new Date(placedAt.getTime() + RESERVATION_TTL_MS);
        const lockedItems = await this.findLiveItemsForUpdate(command);
        let order: OrderEntity;
        try {
            for (const { itemId, quantity } of command.items) {
                orderItems.push(OrderItemEntity.create({ quantity, item: lockedItems.get(itemId)! }));
            }
            order = OrderEntity.place({
                member: this.memberRepository.getReference(memberId),
                orderNumber,
                idempotencyKey: command.idempotencyKey,
                requestFingerprint,
                currencyCode: 'KRW',
                items: orderItems,
                placedAt,
            });
        } catch (error: unknown) {
            if (error instanceof RangeError) throw new BadRequestException(error.message);
            throw error;
        }
        await this.inventory.reserveForPlacementBatch(
            orderItems.map((orderItem, index) => ({
                orderItem,
                idempotencyKey: `order:${orderNumber}:line:${index}:reserve`,
            })),
            reservationExpiresAt,
            orderNumber,
            placedAt
        );
        this.em.persist(order);

        return order;
    }

    private async findLiveItemsForUpdate(command: PlaceOrderCommand): Promise<Map<bigint, ItemEntity>> {
        const itemIds = [...new Set(command.items.map(({ itemId }) => itemId))].sort(compareBigInt);
        const discovered = new Map<bigint, ItemEntity>();
        for (const itemId of itemIds) {
            const item = await this.itemRepository.findOne(
                { id: itemId, deletedAt: null },
                { populate: ['product'], connectionType: 'write' }
            );
            if (!item) throw new BadRequestException(new NotExistingItem());
            discovered.set(itemId, item);
        }

        const productIds = [...new Set([...discovered.values()].map(({ product }) => product.id))].sort(compareBigInt);
        const lockedProducts = new Map<bigint, ProductStatus>();
        for (const productId of productIds) {
            const product = await this.em.findOne(
                ProductEntity,
                { id: productId, deletedAt: null },
                {
                    connectionType: 'write',
                    lockMode: LockMode.PESSIMISTIC_WRITE,
                    refresh: true,
                }
            );
            if (!product || product.status !== ProductStatus.ACTIVE) {
                throw new BadRequestException(new NotExistingItem());
            }
            lockedProducts.set(product.id, product.status);
        }

        const lockedItems = new Map<bigint, ItemEntity>();
        for (const itemId of itemIds) {
            const item = await this.itemRepository.findOne(
                { id: itemId, deletedAt: null },
                {
                    populate: ['product', 'optionValues.option', 'optionValues.value'],
                    connectionType: 'write',
                    lockMode: LockMode.PESSIMISTIC_WRITE,
                    refresh: true,
                }
            );
            if (
                !item ||
                item.saleStatus !== ItemSaleStatus.ALLOW ||
                lockedProducts.get(item.product.id) !== ProductStatus.ACTIVE
            ) {
                throw new BadRequestException(new NotExistingItem());
            }
            lockedItems.set(item.id, item);
        }
        return lockedItems;
    }

    private findIdempotentOrder(memberId: bigint, idempotencyKey: string): Promise<OrderEntity | null> {
        return this.orderRepository.findOne(
            { member: memberId, idempotencyKey, deletedAt: null },
            {
                populate: ['items.item', 'items.snapshot'],
                connectionType: 'write',
                refresh: true,
            }
        );
    }

    private assertSamePlaceOrder(order: OrderEntity, requestFingerprint: string): OrderEntity {
        if (order.requestFingerprint !== requestFingerprint) {
            throw new ConflictException('같은 멱등성 키가 다른 주문 요청에 사용되었습니다.');
        }
        return order;
    }

    private placeOrderFingerprint(command: PlaceOrderCommand): string {
        const normalizedItems = command.items
            .map(({ itemId, quantity }) => [itemId.toString(), quantity] as const)
            .sort(([leftId, leftQuantity], [rightId, rightQuantity]) => {
                const idOrder = leftId.localeCompare(rightId);
                return idOrder === 0 ? leftQuantity - rightQuantity : idOrder;
            });
        return createHash('sha256')
            .update(JSON.stringify({ items: normalizedItems }))
            .digest('hex');
    }

    private assertPlaceOrderIdempotencyKey(value: string): void {
        if (value.trim().length === 0 || value.length > 128) {
            throw new BadRequestException('주문 생성 멱등성 키는 1자 이상 128자 이하여야 합니다.');
        }
    }

    private assertPlaceOrderItems(command: PlaceOrderCommand): void {
        if (command.items.length === 0) throw new BadRequestException('주문 품목은 하나 이상이어야 합니다.');
        if (command.items.some(({ quantity }) => !isPositiveMysqlSignedInt(quantity))) {
            throw new BadRequestException('주문 수량은 1 이상 2147483647 이하의 정수여야 합니다.');
        }
    }

    private cancellationMovementKey(orderId: bigint, reservationId: bigint, idempotencyKey: string): string {
        const digest = createHash('sha256').update(`${orderId}:${reservationId}:${idempotencyKey}`).digest('hex');
        return `cancel:${digest}`;
    }

    private assertOrderOwnerOrAdmin(jwtPayload: JwtPayload, order: OrderEntity): void {
        if (jwtPayload.role === MemberRole.ADMIN || order.member.id === jwtPayload.memberId) return;
        throw new ForbiddenException('다른 회원의 주문을 취소할 수 없습니다.');
    }
}

function compareBigInt(left: bigint, right: bigint): number {
    return left < right ? -1 : left > right ? 1 : 0;
}
