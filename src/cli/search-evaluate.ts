import { NestFactory } from '@nestjs/core';

import { readFile } from 'node:fs/promises';
import {
    RelevanceEvaluationFixture,
    SearchRelevanceEvaluationService,
} from '~/infra/search/search-relevance-evaluation.service';
import { MaintenanceAppModule } from '~/maintenance-app.module';

async function main(): Promise<void> {
    const args = parseArguments(process.argv.slice(2));
    const fixture = JSON.parse(await readFile(args.fixture, 'utf8')) as RelevanceEvaluationFixture;
    const app = await NestFactory.createApplicationContext(MaintenanceAppModule, { logger: ['error', 'warn'] });
    try {
        const result = await app
            .get(SearchRelevanceEvaluationService)
            .compare(fixture, args.baselineAlias, args.candidateAlias);
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } finally {
        await app.close();
    }
}

function parseArguments(values: string[]): { fixture: string; baselineAlias: string; candidateAlias: string } {
    const options = new Map<string, string>();
    for (let index = 0; index < values.length; index += 2) {
        const key = values[index];
        const value = values[index + 1];
        if (!key?.startsWith('--') || !value) throw usageError();
        options.set(key, value);
    }
    const fixture = options.get('--fixture');
    const baselineAlias = options.get('--baseline');
    const candidateAlias = options.get('--candidate');
    if (!fixture || !baselineAlias || !candidateAlias || options.size !== 3) throw usageError();
    return { fixture, baselineAlias, candidateAlias };
}

function usageError(): Error {
    return new Error('Usage: search-evaluate --fixture <path> --baseline <alias> --candidate <alias>');
}

void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Unknown search evaluation error';
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
});
