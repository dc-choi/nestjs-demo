import { NestFactory } from '@nestjs/core';

import { SearchOutboxRecoveryService } from '~/infra/search/search-outbox-recovery.service';
import { MaintenanceAppModule } from '~/maintenance-app.module';

async function main(): Promise<void> {
    const options = parseArguments(process.argv.slice(2));
    const app = await NestFactory.createApplicationContext(MaintenanceAppModule, { logger: ['error', 'warn'] });
    try {
        const events = await app.get(SearchOutboxRecoveryService).inspectDeadLetters(options);
        process.stdout.write(`${JSON.stringify(events)}\n`);
    } finally {
        await app.close();
    }
}

function parseArguments(values: readonly string[]): { productId?: bigint; limit: number } {
    let productId: bigint | undefined;
    let limit = 50;
    for (let index = 0; index < values.length; index += 2) {
        const key = values[index];
        const value = values[index + 1];
        if (!value) throw usageError();
        if (key === '--product-id') {
            if (productId !== undefined) throw usageError();
            productId = parseId(value);
        } else if (key === '--limit') {
            limit = parseLimit(value);
        } else {
            throw usageError();
        }
    }
    return { productId, limit };
}

function parseId(value: string): bigint {
    if (!/^\d+$/.test(value) || BigInt(value) < 1n) throw usageError();
    return BigInt(value);
}

function parseLimit(value: string): number {
    const limit = Number(value);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw usageError();
    return limit;
}

function usageError(): Error {
    return new Error('Usage: search-outbox-dead-letter-inspect [--product-id <positive-id>] [--limit <1..100>]');
}

void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Unknown search outbox dead-letter inspection error';
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
});
