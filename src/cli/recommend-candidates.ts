import { NestFactory } from '@nestjs/core';

import { RecommendationCandidateService } from '~/api/recommendation/application/recommendation-candidate.service.js';
import { SearchMaintenanceAppModule } from '~/search-maintenance-app.module.js';

async function main(): Promise<void> {
    const args = parseArguments(process.argv.slice(2));
    const app = await NestFactory.createApplicationContext(SearchMaintenanceAppModule, { logger: ['error', 'warn'] });
    try {
        const result = await app.get(RecommendationCandidateService).findCandidates(args.user, args.version);
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } finally {
        await app.close();
    }
}

function parseArguments(values: string[]): { user: string; version?: string } {
    const options = new Map<string, string>();
    for (let index = 0; index < values.length; index += 2) {
        const key = values[index];
        const value = values[index + 1];
        if ((key !== '--user' && key !== '--version') || !value || options.has(key)) throw usageError();
        options.set(key, value);
    }
    const user = options.get('--user');
    if (!user) throw usageError();
    return { user, version: options.get('--version') };
}

function usageError(): Error {
    return new Error('Usage: recommend-candidates --user <id> [--version <profile version>]');
}

void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Unknown recommendation candidate error';
    const cause = error instanceof Error && error.cause instanceof Error ? `: ${error.cause.message}` : '';
    process.stderr.write(`${message}${cause}\n`);
    process.exitCode = 1;
});
