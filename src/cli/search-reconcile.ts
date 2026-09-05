import { NestFactory } from '@nestjs/core';

import { SearchReconciliationService } from '~/infra/search/search-reconciliation.service';
import { MaintenanceAppModule } from '~/maintenance-app.module';

async function main(): Promise<void> {
    const repair = process.argv.slice(2).includes('--repair');
    const unknown = process.argv.slice(2).filter((argument) => argument !== '--repair');
    if (unknown.length > 0) throw new Error('Usage: search-reconcile [--repair]');

    const app = await NestFactory.createApplicationContext(MaintenanceAppModule, { logger: ['error', 'warn'] });
    try {
        const result = await app.get(SearchReconciliationService).reconcile({ repair });
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } finally {
        await app.close();
    }
}

void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Unknown search reconciliation error';
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
});
