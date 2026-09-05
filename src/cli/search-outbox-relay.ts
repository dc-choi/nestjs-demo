import { NestFactory } from '@nestjs/core';

import { SearchOutboxRelay } from '~/infra/search/search-outbox.relay';
import { MaintenanceAppModule } from '~/maintenance-app.module';

async function main(): Promise<void> {
    const app = await NestFactory.createApplicationContext(MaintenanceAppModule, { logger: ['error', 'warn'] });
    try {
        const result = await app.get(SearchOutboxRelay).drainUntilEmpty();
        process.stdout.write(`${JSON.stringify(result)}\n`);
        if (result.failed > 0) process.exitCode = 1;
    } finally {
        await app.close();
    }
}

void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Unknown search outbox relay error';
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
});
