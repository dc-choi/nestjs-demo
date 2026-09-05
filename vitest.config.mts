import { fileURLToPath } from 'node:url';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    plugins: [
        swc.vite({
            swcrc: false,
            configFile: false,
            module: { type: 'es6' },
            jsc: {
                target: 'esnext',
                parser: { syntax: 'typescript', decorators: true },
                transform: { legacyDecorator: true, decoratorMetadata: true },
                keepClassNames: true,
            },
            sourceMaps: true,
        }),
    ],
    resolve: {
        alias: {
            '~': fileURLToPath(new URL('./src', import.meta.url)),
            'test': fileURLToPath(new URL('./test', import.meta.url)),
        },
    },
    test: {
        environment: 'node',
        pool: 'threads',
        fsModuleCache: true,
        setupFiles: ['reflect-metadata'],
        clearMocks: true,
        restoreMocks: true,
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json', 'lcov'],
            include: ['src/**/*.ts'],
        },
        projects: [
            {
                test: {
                    name: 'unit',
                    include: ['test/unit/**/*.test.ts'],
                },
            },
            {
                test: {
                    name: 'integration',
                    include: ['test/integration/**/*.test.ts'],
                    // These suites share an integration database and clear its schema.
                    fileParallelism: false,
                },
            },
            {
                test: {
                    name: 'e2e',
                    include: ['test/e2e/**/*.e2e.test.ts'],
                    fileParallelism: false,
                },
            },
        ],
    },
});
