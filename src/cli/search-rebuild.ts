import { NestFactory } from '@nestjs/core';

import { CatalogAnalyzer } from '~/infra/search/catalog-index.definition';
import { CatalogRebuildService } from '~/infra/search/catalog-rebuild.service';
import { MaintenanceAppModule } from '~/maintenance-app.module';

async function main(): Promise<void> {
    const options = parseArguments(process.argv.slice(2));
    const app = await NestFactory.createApplicationContext(MaintenanceAppModule, { logger: ['error', 'warn', 'log'] });
    try {
        const result = await app.get(CatalogRebuildService).rebuild(options);
        process.stdout.write(`${JSON.stringify(result)}\n`);
    } finally {
        await app.close();
    }
}

function parseArguments(values: string[]): {
    buildId?: string;
    batchSize?: number;
    analyzer?: CatalogAnalyzer;
    activate?: boolean;
    evaluationAlias?: string;
} {
    const options: {
        buildId?: string;
        batchSize?: number;
        analyzer?: CatalogAnalyzer;
        activate?: boolean;
        evaluationAlias?: string;
    } = {};
    for (let index = 0; index < values.length; ) {
        const key = values[index];
        if (key === '--no-activate') {
            options.activate = false;
            index += 1;
            continue;
        }
        const value = values[index + 1];
        if (!value) throw usageError();
        if (key === '--build-id') options.buildId = value;
        else if (key === '--batch-size') options.batchSize = Number(value);
        else if (key === '--analyzer' && (value === 'standard' || value === 'nori')) options.analyzer = value;
        else if (key === '--evaluation-alias') options.evaluationAlias = value;
        else throw usageError();
        index += 2;
    }
    return options;
}

function usageError(): Error {
    return new Error(
        'Usage: search-rebuild [--build-id <id>] [--batch-size <1..500>] [--analyzer standard|nori] [--no-activate] [--evaluation-alias <alias>]'
    );
}

void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Unknown search rebuild error';
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
});
