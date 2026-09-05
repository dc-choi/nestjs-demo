import { BeforeApplicationShutdown, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';

import { CatalogIndexManager } from './catalog-index.manager';
import { SearchOutboxRelay } from './search-outbox.relay';
import { SearchConfig } from './search.config';

const POLL_INTERVAL_MS = 1_000;
export const SEARCH_OUTBOX_SHUTDOWN_TIMEOUT_MS = 5_000;
/**
 * Continuously drains committed catalog events while search is enabled.
 * Database leases make concurrent application replicas safe; each instance keeps only one local poll in flight.
 */
@Injectable()
export class SearchOutboxWorker implements OnApplicationBootstrap, BeforeApplicationShutdown {
    private readonly logger = new Logger(SearchOutboxWorker.name);
    private timer: NodeJS.Timeout | undefined;
    private inFlight: Promise<void> | undefined;
    private pollAbortController: AbortController | undefined;
    private stopped = false;
    private missingAliasReported = false;

    constructor(
        private readonly config: SearchConfig,
        private readonly relay: SearchOutboxRelay,
        private readonly indexManager: CatalogIndexManager
    ) {}

    onApplicationBootstrap(): void {
        if (!this.config.enabled) return;
        this.schedule(0);
    }

    async beforeApplicationShutdown(): Promise<void> {
        this.stopped = true;
        if (this.timer) clearTimeout(this.timer);
        this.timer = undefined;
        this.pollAbortController?.abort();

        const inFlight = this.inFlight;
        if (!inFlight) return;

        let timeout: NodeJS.Timeout | undefined;
        let timedOut = false;
        await Promise.race([
            inFlight,
            new Promise<void>((resolve) => {
                timeout = setTimeout(() => {
                    timedOut = true;
                    resolve();
                }, SEARCH_OUTBOX_SHUTDOWN_TIMEOUT_MS);
            }),
        ]);
        if (timeout) clearTimeout(timeout);
        if (timedOut) {
            this.logger.warn('Search outbox shutdown timed out; leased rows will recover after lease expiry');
        }
    }

    private schedule(delay: number): void {
        if (this.stopped) return;
        this.timer = setTimeout(() => {
            this.timer = undefined;
            const abortController = new AbortController();
            this.pollAbortController = abortController;
            const poll = this.poll(abortController.signal);
            this.inFlight = poll;
            void poll.finally(() => {
                if (this.inFlight === poll) this.inFlight = undefined;
                if (this.pollAbortController === abortController) this.pollAbortController = undefined;
            });
        }, delay);
        this.timer.unref();
    }

    private async poll(signal: AbortSignal): Promise<void> {
        try {
            if (!(await this.indexManager.hasAlias(this.config.writeAlias))) {
                if (!this.missingAliasReported) {
                    this.logger.warn(
                        `Search outbox is waiting for write alias ${this.config.writeAlias}; run search:rebuild before relay starts`
                    );
                    this.missingAliasReported = true;
                }
                return;
            }
            this.missingAliasReported = false;
            const result = await this.relay.drainUntilEmpty({ maxBatches: 20, signal });
            if (result.claimed > 0) {
                const summary = JSON.stringify(result);
                if (result.failed > 0) this.logger.warn(`Search outbox poll completed with failures: ${summary}`);
                else this.logger.log(`Search outbox poll completed: ${summary}`);
            }
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Unknown search outbox worker error';
            this.logger.error(`Search outbox poll failed: ${message}`);
        } finally {
            this.schedule(POLL_INTERVAL_MS);
        }
    }
}
