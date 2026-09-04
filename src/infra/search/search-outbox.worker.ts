import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';

import { CatalogIndexManager } from './catalog-index.manager';
import { SearchOutboxRelay } from './search-outbox.relay';
import { SearchConfig } from './search.config';

const POLL_INTERVAL_MS = 1_000;
const SEARCH_MAINTENANCE_ENTRYPOINTS = new Set([
    'inventory-expire.js',
    'search-evaluate.js',
    'search-outbox-relay.js',
    'search-rebuild.js',
    'search-reconcile.js',
]);

/**
 * Continuously drains committed catalog events while search is enabled.
 * Database leases make concurrent application replicas safe; each instance keeps only one local poll in flight.
 */
@Injectable()
export class SearchOutboxWorker implements OnApplicationBootstrap, OnApplicationShutdown {
    private readonly logger = new Logger(SearchOutboxWorker.name);
    private timer: NodeJS.Timeout | undefined;
    private stopped = false;
    private missingAliasReported = false;

    constructor(
        private readonly config: SearchConfig,
        private readonly relay: SearchOutboxRelay,
        private readonly indexManager: CatalogIndexManager
    ) {}

    onApplicationBootstrap(): void {
        if (!this.config.enabled || isSearchMaintenanceProcess()) return;
        this.schedule(0);
    }

    onApplicationShutdown(): void {
        this.stopped = true;
        if (this.timer) clearTimeout(this.timer);
        this.timer = undefined;
    }

    private schedule(delay: number): void {
        if (this.stopped) return;
        this.timer = setTimeout(() => void this.poll(), delay);
        this.timer.unref();
    }

    private async poll(): Promise<void> {
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
            const result = await this.relay.drainUntilEmpty({ maxBatches: 20 });
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

function isSearchMaintenanceProcess(): boolean {
    const entrypoint = process.argv[1]?.replaceAll('\\', '/').split('/').at(-1);
    return entrypoint !== undefined && SEARCH_MAINTENANCE_ENTRYPOINTS.has(entrypoint);
}
