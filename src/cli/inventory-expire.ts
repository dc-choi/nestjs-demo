import { NestFactory } from '@nestjs/core';

import { InventoryService } from '~/api/inventory/application/inventory.service';
import { AppModule } from '~/app.module';

async function main(): Promise<void> {
    const limit = parseLimit(process.argv.slice(2));
    const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
    try {
        const result = await app.get(InventoryService).expireDueBatch(limit);
        process.stdout.write(`${JSON.stringify(result)}\n`);
        if (result.failures.length > 0) process.exitCode = 1;
    } finally {
        await app.close();
    }
}

function parseLimit(arguments_: readonly string[]): number {
    if (arguments_.length === 0) return 100;
    if (arguments_.length !== 2 || arguments_[0] !== '--limit') throw usageError();

    const limit = Number(arguments_[1]);
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw usageError();
    return limit;
}

function usageError(): Error {
    return new Error('Usage: inventory-expire [--limit <1..500>]');
}

void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Unknown inventory expiration error';
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
});
