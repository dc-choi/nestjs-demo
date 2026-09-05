import {
    BadRequestException,
    Body,
    Controller,
    Headers,
    HttpCode,
    Inject,
    Param,
    Post,
    RawBodyRequest,
    Req,
    UnauthorizedException,
} from '@nestjs/common';

import { IsEnum, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { Request } from 'express';
import { createHash } from 'node:crypto';
import { PaymentWebhookOutcome } from '~/api/payment/application/payment.command';
import { PaymentService } from '~/api/payment/application/payment.service';
import {
    PAYMENT_WEBHOOK_SIGNATURE_VERIFIER,
    PaymentWebhookSignatureVerifier,
} from '~/api/payment/infrastructure/payment-webhook-signature.verifier';

class PaymentWebhookHttpBody {
    @IsOptional()
    @IsString()
    @MaxLength(255)
    providerPaymentId?: string | null;

    @IsEnum(PaymentWebhookOutcome)
    outcome!: PaymentWebhookOutcome;

    @IsOptional()
    @IsString()
    @MaxLength(255)
    providerTransactionId?: string | null;

    @IsOptional()
    @Matches(/^\d+(?:\.\d{1,3})?$/)
    amount?: string | null;

    @IsOptional()
    @IsString()
    @MaxLength(128)
    errorCode?: string | null;

    @IsOptional()
    @IsString()
    errorMessage?: string | null;
}

@Controller('webhooks/payments')
export class PaymentWebhookController {
    constructor(
        private readonly paymentService: PaymentService,
        @Inject(PAYMENT_WEBHOOK_SIGNATURE_VERIFIER)
        private readonly signatureVerifier: PaymentWebhookSignatureVerifier
    ) {}

    @Post(':provider')
    @HttpCode(200)
    async receive(
        @Param('provider') provider: string,
        @Headers('x-payment-event-id') providerEventId: string | undefined,
        @Headers('x-payment-signature') signature: string | undefined,
        @Req() request: RawBodyRequest<Request>,
        @Body() body: PaymentWebhookHttpBody
    ): Promise<{ eventId: string; status: string }> {
        if (!providerEventId || !signature) {
            throw new BadRequestException('Webhook 이벤트 ID와 서명이 필요합니다.');
        }
        if (provider.trim().length === 0 || provider.length > 64 || providerEventId.length > 255) {
            throw new BadRequestException('Webhook 제공자 또는 이벤트 ID가 올바르지 않습니다.');
        }
        if (!request.rawBody) {
            throw new BadRequestException('Webhook 서명 검증을 위한 raw body가 필요합니다.');
        }
        if (!Object.values(PaymentWebhookOutcome).includes(body.outcome)) {
            throw new BadRequestException('Webhook 처리 결과가 올바르지 않습니다.');
        }

        const verified = await this.signatureVerifier.verify({
            provider,
            providerEventId,
            rawBody: request.rawBody,
            signature,
        });
        if (!verified) throw new UnauthorizedException('Webhook 서명이 올바르지 않습니다.');

        const payloadHash = createHash('sha256').update(request.rawBody).digest('hex');
        await this.paymentService.receiveWebhook({
            provider,
            providerEventId,
            providerPaymentId: body.providerPaymentId,
            payloadHash,
        });

        try {
            const { event } = await this.paymentService.processWebhook({
                ...body,
                provider,
                providerEventId,
                payloadHash,
            });
            return { eventId: event.providerEventId, status: event.status };
        } catch (error) {
            await this.paymentService.failWebhook(provider, providerEventId, this.safeErrorMessage(error));
            throw error;
        }
    }

    private safeErrorMessage(error: unknown): string {
        return error instanceof Error ? error.message.slice(0, 1000) : 'Webhook 처리 실패';
    }
}
