import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, onTestFinished } from 'vitest';
import { runWithRequestContext } from '~/global/common/context/request-context';
import { createWinstonLogging } from '~/global/config/logger/winston.config';

describe('Winston logging lifecycle', () => {
    it('keeps channels scoped to their owner and flushes structured logs on shutdown', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'demo-nest-logging-'));
        const first = createWinstonLogging(join(directory, 'first'));
        const second = createWinstonLogging(join(directory, 'second'));
        onTestFinished(async () => {
            await Promise.all([first.onApplicationShutdown(), second.onApplicationShutdown()]);
            await rm(directory, { recursive: true, force: true });
        });

        runWithRequestContext('request-first', () => first.verbose.log({ type: 'FIRST', env: 'test' }));
        runWithRequestContext('request-second', () => second.verbose.log({ type: 'SECOND', env: 'test' }));
        await Promise.all([first.onApplicationShutdown(), second.onApplicationShutdown()]);

        const readLog = async (owner: string) => {
            const path = join(directory, owner, 'verbose');
            const file = (await readdir(path)).find((name) => name.endsWith('.log'));
            expect(file).toBeDefined();
            return JSON.parse((await readFile(join(path, file!), 'utf8')).trim());
        };
        await expect(readLog('first')).resolves.toMatchObject({
            type: 'FIRST',
            level: 'verbose',
            requestId: 'request-first',
        });
        await expect(readLog('second')).resolves.toMatchObject({
            type: 'SECOND',
            level: 'verbose',
            requestId: 'request-second',
        });
    });
});
