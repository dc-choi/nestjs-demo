import { BeforeApplicationShutdown, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';

import { PaymentWebhookRecoveryRelay } from '~/api/payment/application/payment-webhook-recovery.relay';

const POLL_INTERVAL_MS = 1_000;

/** Register this worker only in the HTTP application composition root. */
@Injectable()
export class PaymentWebhookRecoveryWorker implements OnApplicationBootstrap, BeforeApplicationShutdown {
    private readonly logger = new Logger(PaymentWebhookRecoveryWorker.name);
    private timer: NodeJS.Timeout | undefined;
    private inFlight: Promise<void> | undefined;
    private stopped = false;

    constructor(private readonly relay: PaymentWebhookRecoveryRelay) {}

    onApplicationBootstrap(): void {
        this.schedule(0);
    }

    async beforeApplicationShutdown(): Promise<void> {
        this.stopped = true;
        if (this.timer) clearTimeout(this.timer);
        this.timer = undefined;
        await this.inFlight;
    }

    private schedule(delay: number): void {
        if (this.stopped) return;
        this.timer = setTimeout(() => {
            this.timer = undefined;
            const poll = this.poll();
            this.inFlight = poll;
            void poll.finally(() => {
                if (this.inFlight === poll) this.inFlight = undefined;
            });
        }, delay);
        this.timer.unref();
    }

    private async poll(): Promise<void> {
        try {
            const result = await this.relay.drainBatch();
            if (result.failed > 0) this.logger.warn(`Payment webhook recovery failures: ${JSON.stringify(result)}`);
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Unknown payment webhook recovery error';
            this.logger.error(`Payment webhook recovery poll failed: ${message}`);
        } finally {
            this.schedule(POLL_INTERVAL_MS);
        }
    }
}
