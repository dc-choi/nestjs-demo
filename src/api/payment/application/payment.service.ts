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

import { FulfillmentStatus } from '~/api/fulfillment/domain/fulfillment.enum';
import { InventoryReservationStatus } from '~/api/inventory/domain/inventory.enum';
import { MemberRole } from '~/api/member/domain/member-role';
import { OrderEntity } from '~/api/order/domain/entity/order.entity';
import { OrderActorType, OrderStatus } from '~/api/order/domain/entity/order.enum';
import { PAYMENT_INVENTORY_PORT, type PaymentInventoryPort } from '~/api/payment/application/payment-inventory.port';
import type { PaymentResult } from '~/api/payment/application/payment-result';
import type {
    CapturePaymentCommand,
    CreatePaymentAttemptCommand,
    FailPaymentCommand,
    ProcessPaymentWebhookCommand,
    RefundPaymentCommand,
} from '~/api/payment/application/payment.command';
import { PaymentWebhookOutcome } from '~/api/payment/application/payment.command';
import { PaymentAttemptEntity } from '~/api/payment/domain/payment-attempt.entity';
import { assertPositiveMoney, compareMoney, sumMoney } from '~/api/payment/domain/payment-money';
import { PaymentTransactionEntity } from '~/api/payment/domain/payment-transaction.entity';
import {
    PaymentAttemptStatus,
    PaymentTransactionStatus,
    PaymentTransactionType,
} from '~/api/payment/domain/payment.enum';
import type { JwtPayload } from '~/global/jwt/payload/jwt.payload';

const BLOCKING_FULL_REFUND_FULFILLMENT_STATUSES: readonly FulfillmentStatus[] = [
    FulfillmentStatus.PENDING,
    FulfillmentStatus.PACKED,
    FulfillmentStatus.SHIPPED,
];

export class PaymentWebhookPrerequisitePending extends ConflictException {}

@Injectable()
export class PaymentService {
    constructor(
        private readonly em: EntityManager,
        @InjectRepository(OrderEntity)
        private readonly orderRepository: EntityRepository<OrderEntity>,
        @InjectRepository(PaymentAttemptEntity)
        private readonly attemptRepository: EntityRepository<PaymentAttemptEntity>,
        @InjectRepository(PaymentTransactionEntity)
        private readonly transactionRepository: EntityRepository<PaymentTransactionEntity>,
        @Inject(PAYMENT_INVENTORY_PORT)
        private readonly inventory: PaymentInventoryPort
    ) {}

    async createAttempt(
        jwtPayload: JwtPayload,
        command: CreatePaymentAttemptCommand,
        now = new Date()
    ): Promise<PaymentResult> {
        this.assertCreateAttemptCommand(command);
        try {
            return await this.createAttemptInTransaction(jwtPayload, command, now);
        } catch (error: unknown) {
            if (!(error instanceof UniqueConstraintViolationException)) throw error;

            const concurrentReplay = await this.attemptRepository.findOne(
                { provider: command.provider, idempotencyKey: command.idempotencyKey },
                {
                    populate: ['order.member', 'transactions'],
                    connectionType: 'write',
                    refresh: true,
                }
            );
            if (concurrentReplay) {
                this.assertOwnerOrAdmin(jwtPayload, concurrentReplay.order);
                this.assertSameAttempt(concurrentReplay, command);
                return { attempt: concurrentReplay, transaction: null };
            }

            const providerPaymentConflict = command.providerPaymentId
                ? await this.attemptRepository.findOne(
                      { provider: command.provider, providerPaymentId: command.providerPaymentId },
                      { connectionType: 'write', refresh: true }
                  )
                : null;
            if (providerPaymentConflict) {
                throw new ConflictException('결제 제공자 결제 ID가 이미 사용되었습니다.');
            }
            throw error;
        }
    }

    @Transactional()
    private async createAttemptInTransaction(
        jwtPayload: JwtPayload,
        command: CreatePaymentAttemptCommand,
        now: Date
    ): Promise<PaymentResult> {
        const existing = await this.attemptRepository.findOne(
            { provider: command.provider, idempotencyKey: command.idempotencyKey },
            { populate: ['order.member', 'transactions'], connectionType: 'write' }
        );
        if (existing) {
            this.assertOwnerOrAdmin(jwtPayload, existing.order);
            this.assertSameAttempt(existing, command);
            return { attempt: existing, transaction: null };
        }

        const order = await this.orderRepository.findOne(
            { id: command.orderId, deletedAt: null },
            {
                populate: ['member', 'items.inventoryReservation', 'fulfillments'],
                connectionType: 'write',
                lockMode: LockMode.PESSIMISTIC_WRITE,
            }
        );
        if (!order) throw new NotFoundException('주문을 찾을 수 없습니다.');
        this.assertOwnerOrAdmin(jwtPayload, order);
        await this.lockReservations(order);
        const lockedReplay = await this.attemptRepository.findOne(
            { provider: command.provider, idempotencyKey: command.idempotencyKey },
            { populate: ['order.member', 'transactions'], connectionType: 'write', refresh: true }
        );
        if (lockedReplay) {
            this.assertOwnerOrAdmin(jwtPayload, lockedReplay.order);
            this.assertSameAttempt(lockedReplay, command);
            return { attempt: lockedReplay, transaction: null };
        }
        if (order.status !== OrderStatus.PENDING)
            throw new ConflictException('결제 대기 주문만 결제를 시도할 수 있습니다.');

        const reservations = order.items.getItems().map(({ inventoryReservation }) => inventoryReservation);
        if (
            reservations.some(
                (reservation) =>
                    !reservation ||
                    reservation.status !== InventoryReservationStatus.RESERVED ||
                    reservation.expiresAt.getTime() <= now.getTime()
            )
        ) {
            throw new ConflictException('유효한 재고 예약이 없는 주문은 결제를 시도할 수 없습니다.');
        }

        const attempt = PaymentAttemptEntity.create({
            order,
            provider: command.provider,
            method: command.method,
            idempotencyKey: command.idempotencyKey,
            providerPaymentId: command.providerPaymentId,
        });
        this.em.persist(attempt);
        return { attempt, transaction: null };
    }

    @Transactional()
    async capture(jwtPayload: JwtPayload, command: CapturePaymentCommand, now = new Date()): Promise<PaymentResult> {
        this.assertAdmin(jwtPayload);
        this.assertTransactionIdentity(command.idempotencyKey, command.providerTransactionId);
        const attempt = await this.findAttemptForUpdate(command.paymentAttemptId);
        return this.captureAttempt(attempt, command, now);
    }

    @Transactional()
    async fail(jwtPayload: JwtPayload, command: FailPaymentCommand, now = new Date()): Promise<PaymentResult> {
        this.assertAdmin(jwtPayload);
        this.assertIdempotencyKey(command.idempotencyKey);
        if (command.errorCode.trim().length === 0 || command.errorCode.length > 128) {
            throw new BadRequestException('결제 실패 코드가 올바르지 않습니다.');
        }
        const attempt = await this.findAttemptForUpdate(command.paymentAttemptId);
        return this.failAttempt(attempt, command, now);
    }

    @Transactional()
    async refund(jwtPayload: JwtPayload, command: RefundPaymentCommand, now = new Date()): Promise<PaymentResult> {
        this.assertAdmin(jwtPayload);
        this.assertTransactionIdentity(command.idempotencyKey, command.providerTransactionId);
        this.assertPositiveAmount(command.amount);
        const attempt = await this.findAttemptForUpdate(command.paymentAttemptId);
        return this.refundAttempt(attempt, command, now);
    }

    /** Locks the payment aggregate before its webhook inbox row to keep the established lock order. */
    async lockAttemptForWebhook(paymentAttemptId: bigint): Promise<PaymentAttemptEntity> {
        this.assertCallerTransaction();
        return this.findAttemptForUpdate(paymentAttemptId);
    }

    /** Applies a normalized provider outcome while the caller's transaction holds the payment aggregate lock. */
    async applyWebhookOutcome(
        attempt: PaymentAttemptEntity,
        command: ProcessPaymentWebhookCommand,
        idempotencyKey: string,
        now = new Date()
    ): Promise<PaymentResult> {
        this.assertCallerTransaction();
        if (command.outcome === PaymentWebhookOutcome.CAPTURED) {
            if (!command.providerTransactionId) throw new BadRequestException('매입 거래 ID가 필요합니다.');
            this.assertTransactionIdentity(idempotencyKey, command.providerTransactionId);
            return this.captureAttempt(
                attempt,
                {
                    paymentAttemptId: attempt.id,
                    idempotencyKey,
                    providerTransactionId: command.providerTransactionId,
                },
                now
            );
        }
        if (command.outcome === PaymentWebhookOutcome.REFUNDED) {
            if (!command.providerTransactionId || !command.amount) {
                throw new BadRequestException('환불 거래 ID와 금액이 필요합니다.');
            }
            this.assertTransactionIdentity(idempotencyKey, command.providerTransactionId);
            this.assertPositiveAmount(command.amount);
            if (
                attempt.status === PaymentAttemptStatus.PENDING ||
                attempt.status === PaymentAttemptStatus.REQUIRES_ACTION ||
                attempt.status === PaymentAttemptStatus.AUTHORIZED
            ) {
                throw new PaymentWebhookPrerequisitePending('선행 매입 Webhook 처리를 기다리고 있습니다.');
            }
            return this.refundAttempt(
                attempt,
                {
                    paymentAttemptId: attempt.id,
                    amount: command.amount,
                    idempotencyKey,
                    providerTransactionId: command.providerTransactionId,
                },
                now
            );
        }

        if (!command.errorCode) throw new BadRequestException('결제 실패 코드가 필요합니다.');
        this.assertIdempotencyKey(idempotencyKey);
        if (command.errorCode.trim().length === 0 || command.errorCode.length > 128) {
            throw new BadRequestException('결제 실패 코드가 올바르지 않습니다.');
        }
        return this.failAttempt(
            attempt,
            {
                paymentAttemptId: attempt.id,
                idempotencyKey,
                errorCode: command.errorCode,
                errorMessage: command.errorMessage,
            },
            now
        );
    }

    private async findAttemptForUpdate(id: bigint): Promise<PaymentAttemptEntity> {
        const discovered = await this.attemptRepository.findOne(
            { id },
            { populate: ['order'], connectionType: 'write' }
        );
        if (!discovered) throw new NotFoundException('결제 시도를 찾을 수 없습니다.');

        const order = await this.orderRepository.findOne(
            { id: discovered.order.id, deletedAt: null },
            {
                populate: ['member', 'items.inventoryReservation', 'fulfillments'],
                connectionType: 'write',
                lockMode: LockMode.PESSIMISTIC_WRITE,
                refresh: true,
            }
        );
        if (!order) throw new NotFoundException('주문을 찾을 수 없습니다.');

        const attempt = await this.attemptRepository.findOne(
            { id },
            {
                populate: ['order.member', 'order.items.inventoryReservation', 'transactions'],
                connectionType: 'write',
                lockMode: LockMode.PESSIMISTIC_WRITE,
                refresh: true,
            }
        );
        if (!attempt) throw new NotFoundException('결제 시도를 찾을 수 없습니다.');
        attempt.order = order;
        await this.lockReservations(order);
        await this.lockFulfillments(order);
        return attempt;
    }

    private async lockReservations(order: OrderEntity): Promise<void> {
        const reservations = order.items
            .getItems()
            .flatMap(({ inventoryReservation }) => (inventoryReservation ? [inventoryReservation] : []))
            .sort((left, right) => compareBigInt(left.id, right.id));
        for (const reservation of reservations) {
            await this.em.lock(reservation, LockMode.PESSIMISTIC_WRITE);
        }
    }

    private async lockFulfillments(order: OrderEntity): Promise<void> {
        const fulfillments = order.fulfillments.getItems().toSorted((left, right) => compareBigInt(left.id, right.id));
        for (const fulfillment of fulfillments) {
            await this.em.lock(fulfillment, LockMode.PESSIMISTIC_WRITE);
        }
    }

    private async captureAttempt(
        attempt: PaymentAttemptEntity,
        command: CapturePaymentCommand,
        now: Date
    ): Promise<PaymentResult> {
        const duplicate = await this.findTransaction(attempt, command.idempotencyKey, command.providerTransactionId);
        if (duplicate) {
            this.assertSameTransaction(
                duplicate,
                PaymentTransactionType.CAPTURE,
                attempt.requestedAmount,
                command.providerTransactionId
            );
            return { attempt, transaction: duplicate };
        }
        if (attempt.order.status !== OrderStatus.PENDING) {
            throw new ConflictException('결제 대기 주문만 매입할 수 있습니다.');
        }
        if (!attempt.isCapturable()) {
            throw new ConflictException(`${attempt.status} 결제 시도는 매입할 수 없습니다.`);
        }

        const reservations = attempt.order.items.getItems().map(({ inventoryReservation }) => inventoryReservation);
        if (reservations.some((reservation) => !reservation)) {
            throw new ConflictException('모든 주문 품목에 재고 예약이 있어야 합니다.');
        }
        if (
            reservations.some(
                (reservation) =>
                    reservation!.status !== InventoryReservationStatus.RESERVED ||
                    reservation!.expiresAt.getTime() <= now.getTime()
            )
        ) {
            throw new ConflictException('유효한 재고 예약이 없는 주문은 매입할 수 없습니다.');
        }

        attempt.capture(now);
        for (const reservation of reservations) this.inventory.consumeForPayment(reservation!, now);
        const transaction = PaymentTransactionEntity.succeed({
            paymentAttempt: attempt,
            type: PaymentTransactionType.CAPTURE,
            amount: attempt.requestedAmount,
            idempotencyKey: command.idempotencyKey,
            providerTransactionId: command.providerTransactionId,
            processedAt: now,
        });
        this.em.persist(transaction);

        const history = attempt.order.transition({
            to: OrderStatus.CONFIRMED,
            actorType: OrderActorType.PROVIDER,
            actorId: attempt.provider,
            reason: 'PAYMENT_CAPTURED',
            requestId: command.idempotencyKey,
            occurredAt: now,
        });
        if (history) this.em.persist(history);

        return { attempt, transaction };
    }

    private async failAttempt(
        attempt: PaymentAttemptEntity,
        command: FailPaymentCommand,
        now: Date
    ): Promise<PaymentResult> {
        const duplicate = await this.findTransaction(attempt, command.idempotencyKey);
        if (duplicate) {
            this.assertSameFailedTransaction(duplicate, command);
            return { attempt, transaction: duplicate };
        }
        if (attempt.status === PaymentAttemptStatus.FAILED) {
            throw new ConflictException('이미 다른 요청으로 실패 처리된 결제입니다.');
        }
        if (!attempt.isFailable()) {
            throw new ConflictException(`${attempt.status} 결제 시도는 실패 처리할 수 없습니다.`);
        }

        attempt.fail(command.errorCode, command.errorMessage ?? null);
        const transaction = PaymentTransactionEntity.fail({
            paymentAttempt: attempt,
            type: PaymentTransactionType.AUTHORIZE,
            amount: attempt.requestedAmount,
            idempotencyKey: command.idempotencyKey,
            errorCode: command.errorCode,
            errorMessage: command.errorMessage,
            processedAt: now,
        });
        this.em.persist(transaction);
        return { attempt, transaction };
    }

    private async refundAttempt(
        attempt: PaymentAttemptEntity,
        command: RefundPaymentCommand,
        now: Date
    ): Promise<PaymentResult> {
        const duplicate = await this.findTransaction(attempt, command.idempotencyKey, command.providerTransactionId);
        if (duplicate) {
            this.assertSameTransaction(
                duplicate,
                PaymentTransactionType.REFUND,
                command.amount,
                command.providerTransactionId
            );
            return { attempt, transaction: duplicate };
        }
        if (!attempt.isRefundable()) {
            throw new ConflictException(`${attempt.status} 결제 시도는 환불할 수 없습니다.`);
        }

        const succeeded = attempt.transactions
            .getItems()
            .filter(({ status }) => status === PaymentTransactionStatus.SUCCEEDED);
        const capturedAmount = sumMoney(
            succeeded.filter(({ type }) => type === PaymentTransactionType.CAPTURE).map(({ amount }) => amount)
        );
        const refundedAmounts = succeeded
            .filter(({ type }) => type === PaymentTransactionType.REFUND)
            .map(({ amount }) => amount);
        const refundedAmount = sumMoney([...refundedAmounts, command.amount]);
        if (compareMoney(refundedAmount, capturedAmount) > 0) {
            throw new BadRequestException('환불 누적 금액은 매입 금액을 초과할 수 없습니다.');
        }

        const fullyRefunded = compareMoney(refundedAmount, capturedAmount) === 0;
        if (
            fullyRefunded &&
            attempt.order.fulfillments
                .getItems()
                .some(({ status }) => BLOCKING_FULL_REFUND_FULFILLMENT_STATUSES.includes(status))
        ) {
            throw new ConflictException('진행 중인 배송을 취소하거나 완료한 뒤 전액 환불할 수 있습니다.');
        }

        attempt.refund(fullyRefunded);
        const transaction = PaymentTransactionEntity.succeed({
            paymentAttempt: attempt,
            type: PaymentTransactionType.REFUND,
            amount: command.amount,
            idempotencyKey: command.idempotencyKey,
            providerTransactionId: command.providerTransactionId,
            processedAt: now,
        });
        this.em.persist(transaction);
        return { attempt, transaction };
    }

    private async findTransaction(
        attempt: PaymentAttemptEntity,
        idempotencyKey: string,
        providerTransactionId?: string
    ): Promise<PaymentTransactionEntity | null> {
        const idempotencyReplay = await this.transactionRepository.findOne(
            { paymentAttempt: attempt.id, idempotencyKey },
            { connectionType: 'write' }
        );
        if (idempotencyReplay || !providerTransactionId) return idempotencyReplay;

        return this.transactionRepository.findOne(
            { paymentAttempt: attempt.id, providerTransactionId },
            { connectionType: 'write' }
        );
    }

    private assertSameAttempt(attempt: PaymentAttemptEntity, command: CreatePaymentAttemptCommand): void {
        const matches =
            attempt.order.id === command.orderId &&
            attempt.method === (command.method ?? null) &&
            attempt.providerPaymentId === (command.providerPaymentId ?? null);
        if (!matches) throw new ConflictException('결제 멱등성 키가 다른 요청에 사용되었습니다.');
    }

    private assertSameTransaction(
        transaction: PaymentTransactionEntity,
        type: typeof PaymentTransactionType.CAPTURE | typeof PaymentTransactionType.REFUND,
        amount: string,
        providerTransactionId: string
    ): void {
        const matches =
            transaction.type === type &&
            transaction.status === PaymentTransactionStatus.SUCCEEDED &&
            compareMoney(transaction.amount, amount) === 0 &&
            transaction.providerTransactionId === providerTransactionId;
        if (!matches) throw new ConflictException('결제 거래 멱등성 키가 다른 요청에 사용되었습니다.');
    }

    private assertSameFailedTransaction(transaction: PaymentTransactionEntity, command: FailPaymentCommand): void {
        const matches =
            transaction.type === PaymentTransactionType.AUTHORIZE &&
            transaction.status === PaymentTransactionStatus.FAILED &&
            transaction.errorCode === command.errorCode &&
            transaction.errorMessage === (command.errorMessage ?? null);
        if (!matches) throw new ConflictException('결제 거래 멱등성 키가 다른 요청에 사용되었습니다.');
    }

    private assertCreateAttemptCommand(command: CreatePaymentAttemptCommand): void {
        if (command.provider.trim().length === 0 || command.provider.length > 64) {
            throw new BadRequestException('결제 제공자 값이 올바르지 않습니다.');
        }
        this.assertIdempotencyKey(command.idempotencyKey);
        if (command.method != null && (command.method.trim().length === 0 || command.method.length > 64)) {
            throw new BadRequestException('결제 수단 값이 올바르지 않습니다.');
        }
        if (
            command.providerPaymentId != null &&
            (command.providerPaymentId.trim().length === 0 || command.providerPaymentId.length > 255)
        ) {
            throw new BadRequestException('결제 제공자 결제 ID가 올바르지 않습니다.');
        }
    }

    private assertTransactionIdentity(idempotencyKey: string, providerTransactionId: string): void {
        this.assertIdempotencyKey(idempotencyKey);
        if (providerTransactionId.trim().length === 0 || providerTransactionId.length > 255) {
            throw new BadRequestException('결제 제공자 거래 ID가 올바르지 않습니다.');
        }
    }

    private assertIdempotencyKey(value: string): void {
        if (value.trim().length === 0 || value.length > 128) {
            throw new BadRequestException('결제 멱등성 키는 1자 이상 128자 이하여야 합니다.');
        }
    }

    private assertCallerTransaction(): void {
        if (!this.em.isInTransaction()) throw new Error('Payment webhook lifecycle requires the caller transaction');
    }

    private assertPositiveAmount(amount: string): void {
        try {
            assertPositiveMoney(amount);
        } catch (error: unknown) {
            if (error instanceof RangeError || error instanceof TypeError) {
                throw new BadRequestException(error.message);
            }
            throw error;
        }
    }

    private assertOwnerOrAdmin(jwtPayload: JwtPayload, order: OrderEntity): void {
        if (jwtPayload.role === MemberRole.ADMIN || order.member.id === jwtPayload.memberId) return;
        throw new ForbiddenException('다른 회원의 결제를 생성할 수 없습니다.');
    }

    private assertAdmin(jwtPayload: JwtPayload): void {
        if (jwtPayload.role !== MemberRole.ADMIN) throw new ForbiddenException('결제 처리 권한이 없습니다.');
    }
}

function compareBigInt(left: bigint, right: bigint): number {
    return left < right ? -1 : left > right ? 1 : 0;
}
