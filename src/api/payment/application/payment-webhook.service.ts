import { EntityManager, type EntityRepository, LockMode, UniqueConstraintViolationException } from '@mikro-orm/core';
import { Transactional } from '@mikro-orm/decorators/legacy';
import { InjectRepository } from '@mikro-orm/nestjs';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';

import { createHash } from 'node:crypto';
import type { PaymentWebhookRecoveryResult, PaymentWebhookResult } from '~/api/payment/application/payment-result';
import type {
    ProcessPaymentWebhookCommand,
    ReceivePaymentWebhookCommand,
    VerifiedPaymentWebhookCommand,
} from '~/api/payment/application/payment.command';
import { PaymentService, PaymentWebhookPrerequisitePending } from '~/api/payment/application/payment.service';
import { PaymentAttemptEntity } from '~/api/payment/domain/payment-attempt.entity';
import { PaymentTransactionEntity } from '~/api/payment/domain/payment-transaction.entity';
import { PaymentWebhookEventEntity } from '~/api/payment/domain/payment-webhook-event.entity';
import { PaymentWebhookEventStatus } from '~/api/payment/domain/payment.enum';

interface ProcessWebhookOptions {
    readonly rejectFailedEvent?: boolean;
}

@Injectable()
export class PaymentWebhookService {
    constructor(
        private readonly em: EntityManager,
        @InjectRepository(PaymentAttemptEntity)
        private readonly attemptRepository: EntityRepository<PaymentAttemptEntity>,
        @InjectRepository(PaymentTransactionEntity)
        private readonly transactionRepository: EntityRepository<PaymentTransactionEntity>,
        @InjectRepository(PaymentWebhookEventEntity)
        private readonly webhookRepository: EntityRepository<PaymentWebhookEventEntity>,
        private readonly paymentService: PaymentService
    ) {}

    async receiveWebhook(command: ReceivePaymentWebhookCommand, now = new Date()): Promise<PaymentWebhookResult> {
        this.assertWebhookIdentity(command);
        try {
            return await this.storeWebhook(command, null, now);
        } catch (error: unknown) {
            if (!(error instanceof UniqueConstraintViolationException)) throw error;

            const concurrentReplay = await this.webhookRepository.findOne(
                { provider: command.provider, providerEventId: command.providerEventId },
                { populate: ['paymentAttempt'], connectionType: 'write', refresh: true }
            );
            if (!concurrentReplay) throw error;
            this.assertSameWebhook(concurrentReplay, command);
            return { event: concurrentReplay, transaction: null };
        }
    }

    async receiveVerifiedWebhook(
        command: VerifiedPaymentWebhookCommand,
        now = new Date()
    ): Promise<PaymentWebhookResult> {
        this.assertWebhookIdentity(command);
        try {
            return await this.storeWebhook(command, command, now);
        } catch (error: unknown) {
            if (!(error instanceof UniqueConstraintViolationException)) throw error;
            return this.storeWebhook(command, command, now);
        }
    }

    /** Replays only the normalized command stored after signature verification. */
    @Transactional()
    async recoverStoredWebhook(
        provider: string,
        providerEventId: string,
        now = new Date()
    ): Promise<PaymentWebhookRecoveryResult> {
        const event = await this.webhookRepository.findOne(
            { provider, providerEventId },
            { connectionType: 'write', refresh: true }
        );
        if (!event) return { disposition: 'FAILED', errorMessage: 'Webhook 이벤트를 찾을 수 없습니다.' };
        if (event.status === PaymentWebhookEventStatus.PROCESSED) {
            return { disposition: 'PROCESSED', errorMessage: null };
        }
        if (event.status === PaymentWebhookEventStatus.FAILED) {
            return {
                disposition: 'FAILED',
                errorMessage: event.errorMessage ?? 'Webhook 이벤트가 실패 처리되었습니다.',
            };
        }

        const command = event.verifiedCommand();
        if (!command) {
            return { disposition: 'FAILED', errorMessage: '검증된 Webhook 명령이 없는 기존 이벤트입니다.' };
        }
        if (!command.providerPaymentId) {
            return { disposition: 'FAILED', errorMessage: 'Webhook 결제 ID가 없어 재처리할 수 없습니다.' };
        }

        try {
            await this.processWebhook(command, now, { rejectFailedEvent: true });
            return { disposition: 'PROCESSED', errorMessage: null };
        } catch (error: unknown) {
            if (error instanceof NotFoundException || error instanceof PaymentWebhookPrerequisitePending) {
                return { disposition: 'RETRY', errorMessage: this.safeErrorMessage(error) };
            }
            if (error instanceof BadRequestException || error instanceof ConflictException) {
                return { disposition: 'FAILED', errorMessage: this.safeErrorMessage(error) };
            }
            throw error;
        }
    }

    @Transactional()
    async processWebhook(
        command: ProcessPaymentWebhookCommand,
        now = new Date(),
        { rejectFailedEvent = false }: ProcessWebhookOptions = {}
    ): Promise<PaymentWebhookResult> {
        this.assertWebhookIdentity(command);
        const discoveredEvent = await this.webhookRepository.findOne(
            { provider: command.provider, providerEventId: command.providerEventId },
            { populate: ['paymentAttempt'], connectionType: 'write' }
        );
        if (!discoveredEvent) throw new NotFoundException('Webhook 이벤트를 먼저 저장해야 합니다.');
        if (discoveredEvent.payloadHash !== command.payloadHash.toLowerCase()) {
            throw new ConflictException('Webhook payload hash가 저장된 이벤트와 다릅니다.');
        }
        this.assertSameVerifiedWebhook(discoveredEvent, command);

        const discoveredAttempt =
            discoveredEvent.paymentAttempt ?? (await this.findAttemptByProviderPaymentId(command));
        if (!discoveredAttempt) throw new NotFoundException('Webhook 대상 결제 시도를 찾을 수 없습니다.');
        const attempt = await this.paymentService.lockAttemptForWebhook(discoveredAttempt.id);
        const event = await this.webhookRepository.findOne(
            { id: discoveredEvent.id },
            {
                populate: ['paymentAttempt'],
                connectionType: 'write',
                lockMode: LockMode.PESSIMISTIC_WRITE,
                refresh: true,
            }
        );
        if (!event) throw new NotFoundException('Webhook 이벤트를 찾을 수 없습니다.');
        if (rejectFailedEvent && event.status === PaymentWebhookEventStatus.FAILED) {
            throw new ConflictException(event.errorMessage ?? 'Webhook 이벤트가 실패 처리되었습니다.');
        }
        this.assertSameVerifiedWebhook(event, command);
        if (event.paymentAttempt && event.paymentAttempt.id !== attempt.id) {
            throw new ConflictException('Webhook 이벤트가 다른 결제 시도를 가리킵니다.');
        }

        const idempotencyKey = webhookIdempotencyKey(event);
        if (event.status === PaymentWebhookEventStatus.PROCESSED) {
            const transaction = await this.transactionRepository.findOne(
                { paymentAttempt: attempt.id, idempotencyKey },
                { connectionType: 'write' }
            );
            return { event, transaction };
        }

        const result = await this.paymentService.applyWebhookOutcome(attempt, command, idempotencyKey, now);
        event.processed(attempt, now);
        return { event, transaction: result.transaction };
    }

    @Transactional()
    async failWebhook(provider: string, providerEventId: string, errorMessage: string, now = new Date()) {
        const event = await this.webhookRepository.findOne(
            { provider, providerEventId },
            { connectionType: 'write', lockMode: LockMode.PESSIMISTIC_WRITE }
        );
        if (!event) throw new NotFoundException('Webhook 이벤트를 찾을 수 없습니다.');
        if (event.status === PaymentWebhookEventStatus.PROCESSED) {
            throw new ConflictException('처리 완료된 Webhook 이벤트는 실패 처리할 수 없습니다.');
        }
        event.failed(errorMessage, now);
        return { event, transaction: null } satisfies PaymentWebhookResult;
    }

    // A rolled-back insert must not leave pending entities in the next receipt attempt.
    @Transactional({ clear: true })
    private async storeWebhook(
        command: ReceivePaymentWebhookCommand,
        verifiedCommand: VerifiedPaymentWebhookCommand | null,
        now: Date
    ): Promise<PaymentWebhookResult> {
        let existing = await this.webhookRepository.findOne(
            { provider: command.provider, providerEventId: command.providerEventId },
            { populate: ['paymentAttempt'], connectionType: 'write' }
        );
        if (existing && verifiedCommand && !existing.verifiedCommand()) {
            existing = await this.webhookRepository.findOne(
                { id: existing.id },
                {
                    populate: ['paymentAttempt'],
                    connectionType: 'write',
                    lockMode: LockMode.PESSIMISTIC_WRITE,
                    refresh: true,
                }
            );
        }
        if (existing) {
            this.assertSameWebhook(existing, command);
            if (verifiedCommand) {
                if (existing.verifiedCommand()) this.assertSameVerifiedWebhook(existing, verifiedCommand);
                else existing.storeVerifiedCommand(verifiedCommand, now);
            }
            return { event: existing, transaction: null };
        }

        const paymentAttempt = command.providerPaymentId
            ? await this.attemptRepository.findOne(
                  { provider: command.provider, providerPaymentId: command.providerPaymentId },
                  { connectionType: 'write' }
              )
            : null;
        const event = PaymentWebhookEventEntity.receive({
            provider: command.provider,
            providerEventId: command.providerEventId,
            payloadHash: command.payloadHash,
            paymentAttempt,
            verifiedCommand,
            receivedAt: now,
        });
        this.em.persist(event);
        return { event, transaction: null };
    }

    private async findAttemptByProviderPaymentId(
        command: ProcessPaymentWebhookCommand
    ): Promise<PaymentAttemptEntity | null> {
        if (!command.providerPaymentId) return null;
        return this.attemptRepository.findOne(
            { provider: command.provider, providerPaymentId: command.providerPaymentId },
            { populate: ['order'], connectionType: 'write' }
        );
    }

    private assertSameWebhook(event: PaymentWebhookEventEntity, command: ReceivePaymentWebhookCommand): void {
        if (event.payloadHash !== command.payloadHash.toLowerCase()) {
            throw new ConflictException('같은 Webhook 이벤트 ID에 다른 payload가 수신되었습니다.');
        }
        const storedProviderPaymentId = event.providerPaymentId ?? event.paymentAttempt?.providerPaymentId;
        if (
            command.providerPaymentId &&
            storedProviderPaymentId &&
            storedProviderPaymentId !== command.providerPaymentId
        ) {
            throw new ConflictException('Webhook 이벤트가 다른 결제 시도를 가리킵니다.');
        }
    }

    private assertSameVerifiedWebhook(event: PaymentWebhookEventEntity, command: VerifiedPaymentWebhookCommand): void {
        const stored = event.verifiedCommand();
        if (!stored) return;
        const matches =
            stored.providerPaymentId === (command.providerPaymentId ?? null) &&
            stored.outcome === command.outcome &&
            stored.providerTransactionId === (command.providerTransactionId ?? null) &&
            stored.amount === (command.amount ?? null) &&
            stored.errorCode === (command.errorCode ?? null) &&
            stored.errorMessage === (command.errorMessage?.slice(0, 1_000) ?? null);
        if (!matches) throw new ConflictException('같은 Webhook 이벤트 ID에 다른 검증 명령이 수신되었습니다.');
    }

    private assertWebhookIdentity(command: ReceivePaymentWebhookCommand): void {
        if (command.provider.trim().length === 0 || command.provider.length > 64) {
            throw new BadRequestException('결제 제공자 값이 올바르지 않습니다.');
        }
        if (command.providerEventId.trim().length === 0 || command.providerEventId.length > 255) {
            throw new BadRequestException('Webhook 이벤트 ID가 올바르지 않습니다.');
        }
        if (
            command.providerPaymentId != null &&
            (command.providerPaymentId.trim().length === 0 || command.providerPaymentId.length > 255)
        ) {
            throw new BadRequestException('결제 제공자 결제 ID가 올바르지 않습니다.');
        }
        if (!/^[a-f\d]{64}$/i.test(command.payloadHash)) {
            throw new BadRequestException('Webhook payload hash가 올바르지 않습니다.');
        }
    }

    private safeErrorMessage(error: unknown): string {
        return error instanceof Error ? error.message.slice(0, 1_000) : 'Webhook 처리 실패';
    }
}

function webhookIdempotencyKey(event: PaymentWebhookEventEntity): string {
    const digest = createHash('sha256').update(`${event.provider}:${event.providerEventId}`).digest('hex');
    return `webhook:${digest}`;
}
