import { NestFactory } from '@nestjs/core';

import {
    type SearchOutboxDeadLetterRetryOptions,
    SearchOutboxRecoveryService,
} from '~/infra/search/search-outbox-recovery.service';
import { MaintenanceAppModule } from '~/maintenance-app.module';

async function main(): Promise<void> {
    const options = parseArguments(process.argv.slice(2));
    const app = await NestFactory.createApplicationContext(MaintenanceAppModule, { logger: ['error', 'warn'] });
    try {
        const result = await app.get(SearchOutboxRecoveryService).retryDeadLetters(options);
        process.stdout.write(`${JSON.stringify(result)}\n`);
    } finally {
        await app.close();
    }
}

function parseArguments(values: readonly string[]): SearchOutboxDeadLetterRetryOptions {
    const ids: bigint[] = [];
    let productId: bigint | undefined;
    let limit: number | undefined;
    let reason: string | undefined;
    for (let index = 0; index < values.length; index += 2) {
        const key = values[index];
        const value = values[index + 1];
        if (!value) throw usageError();
        if (key === '--id') ids.push(parseId(value));
        else if (key === '--product-id' && productId === undefined) productId = parseId(value);
        else if (key === '--limit' && limit === undefined) limit = parseLimit(value);
        else if (key === '--reason' && reason === undefined) reason = value;
        else throw usageError();
    }

    if (
        reason === undefined ||
        (ids.length === 0 && productId === undefined) ||
        (ids.length > 0 && productId !== undefined)
    ) {
        throw usageError();
    }
    if (productId !== undefined && limit === undefined) throw usageError();
    if (ids.length > 0 && limit !== undefined) throw usageError();
    return ids.length > 0 ? { ids, reason } : { productId: productId!, limit: limit!, reason };
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
    return new Error(
        'Usage: search-outbox-dead-letter-retry (--id <positive-id> [--id <positive-id> ...] | --product-id <positive-id> --limit <1..100>) --reason <reason>'
    );
}

void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Unknown search outbox dead-letter retry error';
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
});
