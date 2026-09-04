import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Resolver } from '@nestjs/graphql';

import { PaymentService } from '~/api/payment/application/payment.service';
import {
    CapturePaymentInput,
    CreatePaymentAttemptInput,
    FailPaymentInput,
    FailPaymentWebhookInput,
    ProcessPaymentWebhookInput,
    ReceivePaymentWebhookInput,
    RefundPaymentInput,
    parsePaymentId,
} from '~/api/payment/presentation/payment.input';
import { toPaymentPayload, toPaymentWebhookPayload } from '~/api/payment/presentation/payment.mapper';
import { PaymentPayload, PaymentWebhookPayload } from '~/api/payment/presentation/payment.type';
import { Jwt } from '~/global/jwt/decorator/jwt.decorator';
import { AdminGuard } from '~/global/jwt/guard/admin.guard';
import { CommonGuard } from '~/global/jwt/guard/common.guard';
import type { JwtPayload } from '~/global/jwt/payload/jwt.payload';

@Resolver()
export class PaymentResolver {
    constructor(private readonly paymentService: PaymentService) {}

    @Mutation(() => PaymentPayload)
    @UseGuards(CommonGuard)
    async createPaymentAttempt(
        @Jwt() jwtPayload: JwtPayload,
        @Args('input') input: CreatePaymentAttemptInput
    ): Promise<PaymentPayload> {
        const result = await this.paymentService.createAttempt(jwtPayload, {
            ...input,
            orderId: parsePaymentId(input.orderId),
        });
        return toPaymentPayload(result);
    }

    @Mutation(() => PaymentPayload)
    @UseGuards(AdminGuard)
    async capturePayment(
        @Jwt() jwtPayload: JwtPayload,
        @Args('input') input: CapturePaymentInput
    ): Promise<PaymentPayload> {
        const result = await this.paymentService.capture(jwtPayload, {
            ...input,
            paymentAttemptId: parsePaymentId(input.paymentAttemptId),
        });
        return toPaymentPayload(result);
    }

    @Mutation(() => PaymentPayload)
    @UseGuards(AdminGuard)
    async failPayment(@Jwt() jwtPayload: JwtPayload, @Args('input') input: FailPaymentInput): Promise<PaymentPayload> {
        const result = await this.paymentService.fail(jwtPayload, {
            ...input,
            paymentAttemptId: parsePaymentId(input.paymentAttemptId),
        });
        return toPaymentPayload(result);
    }

    @Mutation(() => PaymentPayload)
    @UseGuards(AdminGuard)
    async refundPayment(
        @Jwt() jwtPayload: JwtPayload,
        @Args('input') input: RefundPaymentInput
    ): Promise<PaymentPayload> {
        const result = await this.paymentService.refund(jwtPayload, {
            ...input,
            paymentAttemptId: parsePaymentId(input.paymentAttemptId),
        });
        return toPaymentPayload(result);
    }

    @Mutation(() => PaymentWebhookPayload)
    @UseGuards(AdminGuard)
    async receivePaymentWebhook(@Args('input') input: ReceivePaymentWebhookInput): Promise<PaymentWebhookPayload> {
        return toPaymentWebhookPayload(await this.paymentService.receiveWebhook(input));
    }

    @Mutation(() => PaymentWebhookPayload)
    @UseGuards(AdminGuard)
    async processPaymentWebhook(@Args('input') input: ProcessPaymentWebhookInput): Promise<PaymentWebhookPayload> {
        return toPaymentWebhookPayload(await this.paymentService.processWebhook(input));
    }

    @Mutation(() => PaymentWebhookPayload)
    @UseGuards(AdminGuard)
    async failPaymentWebhook(@Args('input') input: FailPaymentWebhookInput): Promise<PaymentWebhookPayload> {
        return toPaymentWebhookPayload(
            await this.paymentService.failWebhook(input.provider, input.providerEventId, input.errorMessage)
        );
    }
}
