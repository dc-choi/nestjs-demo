import { EntityManager, type EntityRepository, LockMode, UniqueConstraintViolationException } from '@mikro-orm/core';
import { Transactional } from '@mikro-orm/decorators/legacy';
import { InjectRepository } from '@mikro-orm/nestjs';
import {
    BadRequestException,
    ConflictException,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';

import type {
    CreateFulfillmentCommand,
    ShipFulfillmentCommand,
} from '~/api/fulfillment/application/fulfillment.command';
import { FulfillmentEntity } from '~/api/fulfillment/domain/fulfillment.entity';
import { FulfillmentStatus } from '~/api/fulfillment/domain/fulfillment.enum';
import { MemberRole } from '~/api/member/domain/member-role';
import { OrderItemEntity } from '~/api/order/domain/entity/order-item.entity';
import { OrderEntity } from '~/api/order/domain/entity/order.entity';
import { OrderActorType, OrderStatus } from '~/api/order/domain/entity/order.enum';
import { PaymentAttemptStatus } from '~/api/payment/domain/payment.enum';
import { isPositiveMysqlSignedInt } from '~/global/common/utils/mysql-number';
import type { JwtPayload } from '~/global/jwt/payload/jwt.payload';

const FUNDED_PAYMENT_STATUSES: readonly PaymentAttemptStatus[] = [
    PaymentAttemptStatus.CAPTURED,
    PaymentAttemptStatus.PARTIALLY_REFUNDED,
];
const CANCELLABLE_FULFILLMENT_STATUSES: readonly FulfillmentStatus[] = [
    FulfillmentStatus.PENDING,
    FulfillmentStatus.PACKED,
];

@Injectable()
export class FulfillmentService {
    constructor(
        private readonly em: EntityManager,
        @InjectRepository(OrderEntity)
        private readonly orderRepository: EntityRepository<OrderEntity>,
        @InjectRepository(FulfillmentEntity)
        private readonly fulfillmentRepository: EntityRepository<FulfillmentEntity>
    ) {}

    async create(jwtPayload: JwtPayload, command: CreateFulfillmentCommand): Promise<FulfillmentEntity> {
        this.assertAdmin(jwtPayload);
        this.assertIdempotencyKey(command.idempotencyKey);
        if (command.items.length === 0) throw new BadRequestException('배송 품목은 하나 이상이어야 합니다.');
        if (command.items.some(({ quantity }) => !isPositiveMysqlSignedInt(quantity))) {
            throw new BadRequestException('배송 수량은 1 이상 2147483647 이하의 정수여야 합니다.');
        }

        try {
            return await this.createInTransaction(command);
        } catch (error: unknown) {
            if (!(error instanceof UniqueConstraintViolationException)) throw error;

            const replay = await this.fulfillmentRepository.findOne(
                { order: command.orderId, idempotencyKey: command.idempotencyKey },
                { populate: ['order', 'items.orderItem'], connectionType: 'write', refresh: true }
            );
            if (!replay) throw error;
            return this.assertSameCreate(replay, command);
        }
    }

    @Transactional()
    private async createInTransaction(command: CreateFulfillmentCommand): Promise<FulfillmentEntity> {
        const order = await this.orderRepository.findOne(
            { id: command.orderId, deletedAt: null },
            {
                populate: ['items', 'fulfillments.items.orderItem', 'paymentAttempts'],
                connectionType: 'write',
                lockMode: LockMode.PESSIMISTIC_WRITE,
            }
        );
        if (!order) throw new NotFoundException('주문을 찾을 수 없습니다.');
        const replay = order.fulfillments
            .getItems()
            .find(({ idempotencyKey }) => idempotencyKey === command.idempotencyKey);
        if (replay) return this.assertSameCreate(replay, command);
        if (order.status !== OrderStatus.CONFIRMED) {
            throw new ConflictException('결제가 확정된 주문만 배송을 만들 수 있습니다.');
        }
        this.assertFunded(order);
        if (new Set(command.items.map(({ orderItemId }) => orderItemId)).size !== command.items.length) {
            throw new BadRequestException('한 배송에 같은 주문 품목을 중복 배정할 수 없습니다.');
        }

        const orderItems = new Map(order.items.getItems().map((item) => [item.id, item]));
        const allocations = command.items.map(({ orderItemId, quantity }) => {
            const orderItem = orderItems.get(orderItemId);
            if (!orderItem) throw new BadRequestException('주문에 속하지 않은 품목입니다.');

            const allocated = this.allocatedQuantity(order, orderItem);
            if (quantity > orderItem.quantity - allocated) {
                throw new BadRequestException('배송 누적 수량은 주문 수량을 초과할 수 없습니다.');
            }
            return { orderItem, quantity };
        });

        const fulfillment = FulfillmentEntity.create(order, command.idempotencyKey, allocations);
        this.em.persist([fulfillment, ...fulfillment.items.getItems()]);
        return fulfillment;
    }

    @Transactional()
    async pack(jwtPayload: JwtPayload, fulfillmentId: bigint, now = new Date()): Promise<FulfillmentEntity> {
        this.assertAdmin(jwtPayload);
        const fulfillment = await this.findForUpdate(fulfillmentId);
        if (fulfillment.status === FulfillmentStatus.PACKED) return fulfillment;
        if (fulfillment.status !== FulfillmentStatus.PENDING) {
            throw new ConflictException(`${fulfillment.status} 배송은 포장 처리할 수 없습니다.`);
        }
        this.assertFunded(fulfillment.order);
        fulfillment.pack(now);
        return fulfillment;
    }

    @Transactional()
    async ship(jwtPayload: JwtPayload, command: ShipFulfillmentCommand, now = new Date()): Promise<FulfillmentEntity> {
        this.assertAdmin(jwtPayload);
        const fulfillment = await this.findForUpdate(command.fulfillmentId);
        if (fulfillment.status === FulfillmentStatus.SHIPPED) {
            if (fulfillment.carrier !== command.carrier || fulfillment.trackingNumber !== command.trackingNumber) {
                throw new ConflictException('이미 발송된 배송의 운송 정보를 변경할 수 없습니다.');
            }
            return fulfillment;
        }
        if (command.carrier.trim().length === 0 || command.carrier.length > 128) {
            throw new BadRequestException('택배사 값이 올바르지 않습니다.');
        }
        if (command.trackingNumber.trim().length === 0 || command.trackingNumber.length > 255) {
            throw new BadRequestException('운송장 번호가 올바르지 않습니다.');
        }
        if (fulfillment.status !== FulfillmentStatus.PACKED) {
            throw new ConflictException(`${fulfillment.status} 배송은 발송 처리할 수 없습니다.`);
        }
        this.assertFunded(fulfillment.order);
        fulfillment.ship(command.carrier, command.trackingNumber, now);
        return fulfillment;
    }

    @Transactional()
    async deliver(jwtPayload: JwtPayload, fulfillmentId: bigint, now = new Date()): Promise<FulfillmentEntity> {
        this.assertAdmin(jwtPayload);
        const fulfillment = await this.findForUpdate(fulfillmentId);
        if (fulfillment.status === FulfillmentStatus.DELIVERED) return fulfillment;
        if (fulfillment.status !== FulfillmentStatus.SHIPPED) {
            throw new ConflictException(`${fulfillment.status} 배송은 배송 완료 처리할 수 없습니다.`);
        }
        this.assertFunded(fulfillment.order);
        fulfillment.deliver(now);

        if (this.isOrderFullyDelivered(fulfillment.order)) {
            const history = fulfillment.order.transition({
                to: OrderStatus.COMPLETED,
                actorType: OrderActorType.MEMBER,
                actorId: jwtPayload.memberId.toString(),
                reason: 'ALL_ITEMS_DELIVERED',
                occurredAt: now,
            });
            if (history) this.em.persist(history);
        }
        return fulfillment;
    }

    @Transactional()
    async cancel(jwtPayload: JwtPayload, fulfillmentId: bigint, now = new Date()): Promise<FulfillmentEntity> {
        this.assertAdmin(jwtPayload);
        const fulfillment = await this.findForUpdate(fulfillmentId);
        if (fulfillment.status === FulfillmentStatus.CANCELLED) return fulfillment;
        if (!CANCELLABLE_FULFILLMENT_STATUSES.includes(fulfillment.status)) {
            throw new ConflictException(`${fulfillment.status} 배송은 취소할 수 없습니다.`);
        }
        fulfillment.cancel(now);
        return fulfillment;
    }

    private async findForUpdate(id: bigint): Promise<FulfillmentEntity> {
        const discovered = await this.fulfillmentRepository.findOne(
            { id },
            { populate: ['order'], connectionType: 'write' }
        );
        if (!discovered) throw new NotFoundException('배송을 찾을 수 없습니다.');

        const order = await this.orderRepository.findOne(
            { id: discovered.order.id, deletedAt: null },
            { connectionType: 'write', lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true }
        );
        if (!order) throw new NotFoundException('주문을 찾을 수 없습니다.');

        await this.em.populate(order, ['items', 'fulfillments.items.orderItem', 'paymentAttempts'], { refresh: true });

        const fulfillment = await this.fulfillmentRepository.findOne(
            { id, order: order.id },
            {
                populate: ['items.orderItem', 'order'],
                connectionType: 'write',
                lockMode: LockMode.PESSIMISTIC_WRITE,
                refresh: true,
            }
        );
        if (!fulfillment) throw new NotFoundException('배송을 찾을 수 없습니다.');
        fulfillment.order = order;
        return fulfillment;
    }

    private assertSameCreate(fulfillment: FulfillmentEntity, command: CreateFulfillmentCommand): FulfillmentEntity {
        const requested = command.items.toSorted(compareAllocation);
        const stored = fulfillment.items
            .getItems()
            .map(({ orderItem, quantity }) => ({ orderItemId: orderItem.id, quantity }))
            .toSorted(compareAllocation);
        const matches =
            fulfillment.order.id === command.orderId &&
            stored.length === requested.length &&
            stored.every(
                ({ orderItemId, quantity }, index) =>
                    orderItemId === requested[index].orderItemId && quantity === requested[index].quantity
            );
        if (!matches) throw new ConflictException('배송 생성 멱등성 키가 다른 요청에 사용되었습니다.');
        return fulfillment;
    }

    private assertFunded(order: OrderEntity): void {
        if (order.paymentAttempts.getItems().some(({ status }) => FUNDED_PAYMENT_STATUSES.includes(status))) return;
        throw new ConflictException('전액 환불되거나 매입되지 않은 주문은 배송을 진행할 수 없습니다.');
    }

    private assertIdempotencyKey(value: string): void {
        if (value.trim().length === 0 || value.length > 128) {
            throw new BadRequestException('배송 생성 멱등성 키는 1자 이상 128자 이하여야 합니다.');
        }
    }

    private allocatedQuantity(order: OrderEntity, orderItem: OrderItemEntity): number {
        return order.fulfillments
            .getItems()
            .filter(({ status }) => status !== FulfillmentStatus.CANCELLED)
            .flatMap(({ items }) => items.getItems())
            .filter((item) => item.orderItem.id === orderItem.id)
            .reduce((sum, { quantity }) => sum + quantity, 0);
    }

    private isOrderFullyDelivered(order: OrderEntity): boolean {
        const deliveredQuantities = new Map<bigint, number>();
        for (const fulfillment of order.fulfillments) {
            if (fulfillment.status !== FulfillmentStatus.DELIVERED) continue;
            for (const item of fulfillment.items) {
                deliveredQuantities.set(
                    item.orderItem.id,
                    (deliveredQuantities.get(item.orderItem.id) ?? 0) + item.quantity
                );
            }
        }

        return order.items.getItems().every((item) => deliveredQuantities.get(item.id) === item.quantity);
    }

    private assertAdmin(jwtPayload: JwtPayload): void {
        if (jwtPayload.role !== MemberRole.ADMIN) throw new ForbiddenException('배송 처리 권한이 없습니다.');
    }
}

function compareAllocation(
    left: { readonly orderItemId: bigint; readonly quantity: number },
    right: { readonly orderItemId: bigint; readonly quantity: number }
): number {
    if (left.orderItemId !== right.orderItemId) return left.orderItemId < right.orderItemId ? -1 : 1;
    return left.quantity - right.quantity;
}
