import { FlatCompat } from '@eslint/eslintrc';
import js from '@eslint/js';
import typescriptEslintEslintPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';

import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import { readdirSync } from 'node:fs';

const compat = new FlatCompat({
    baseDirectory: import.meta.dirname,
    recommendedConfig: js.configs.recommended,
    allConfig: js.configs.all,
});

// Module and layer boundaries from docs/architecture/module-structure.md.
// A later config block replaces an earlier block's options for the same rule, so each file group gets one block.
const apiModules = readdirSync(new URL('./src/api', import.meta.url), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

const layerRestrictions = {
    domain: {
        patterns: [
            {
                regex: '(^|/)(application|presentation|infrastructure)/',
                message: 'domain/은 application/presentation/infrastructure를 import하지 않습니다.',
            },
            {
                regex: '^~/(infra/|global/(?!common/utils/))',
                message: 'domain/은 global/common/utils 외의 global과 infra를 import하지 않습니다.',
            },
        ],
        paths: [
            { name: '@nestjs/common', message: 'domain/은 Nest provider에 의존하지 않습니다.' },
            { name: '@nestjs/config', message: 'domain/은 설정에 의존하지 않습니다.' },
            {
                name: '@mikro-orm/core',
                importNames: ['EntityManager', 'EntityRepository', 'MikroORM'],
                message: '영속화는 application/에서 합니다.',
            },
            {
                name: '@mikro-orm/mysql',
                importNames: ['EntityManager', 'EntityRepository', 'MikroORM'],
                message: '영속화는 application/에서 합니다.',
            },
        ],
    },
    application: {
        patterns: [{ regex: '(^|/)presentation/', message: 'application/은 presentation/을 import하지 않습니다.' }],
    },
    infrastructure: {
        patterns: [{ regex: '(^|/)presentation/', message: 'infrastructure/는 presentation/을 import하지 않습니다.' }],
    },
    presentation: {
        patterns: [
            {
                regex: '(^|/)infrastructure/',
                message: 'presentation/은 application port를 통해 infrastructure를 씁니다.',
            },
        ],
    },
};

// The rule matches raw specifiers without resolving them, so leaving a layer must use the ~/ alias
// for the module and layer checks above to see the target.
const escapeLayer = { regex: '^(\\.\\./){2,}', message: '레이어 밖은 ~/ alias로 import합니다.' };
const escapeModuleRoot = { regex: '^\\.\\./', message: '모듈 밖은 ~/ alias로 import합니다.' };

const boundaryConfigs = apiModules.flatMap((module) => {
    const otherInfrastructure = {
        regex: `^~/api/(?!${module}/)[^/]+/infrastructure/`,
        message: '다른 모듈의 infrastructure/는 import하지 않습니다. 공유 기술 연결은 src/infra/로 올립니다.',
    };
    const layers = Object.entries(layerRestrictions).map(([layer, { patterns, paths = [] }]) => ({
        files: [`src/api/${module}/${layer}/**/*.ts`],
        rules: {
            'no-restricted-imports': ['error', { paths, patterns: [otherInfrastructure, escapeLayer, ...patterns] }],
        },
    }));
    return [
        {
            files: [`src/api/${module}/*.ts`],
            rules: { 'no-restricted-imports': ['error', { patterns: [otherInfrastructure, escapeModuleRoot] }] },
        },
        ...layers,
    ];
});

export default defineConfig([
    {
        languageOptions: {
            parser: tsParser,
            sourceType: 'module',

            parserOptions: {
                project: 'tsconfig.json',
                tsconfigRootDir: import.meta.dirname,
            },

            globals: {
                ...globals.node,
            },
        },

        plugins: {
            '@typescript-eslint': typescriptEslintEslintPlugin,
        },

        extends: compat.extends('plugin:@typescript-eslint/recommended', 'plugin:prettier/recommended'),

        rules: {
            '@typescript-eslint/interface-name-prefix': 'off',
            '@typescript-eslint/explicit-function-return-type': 'off',
            '@typescript-eslint/explicit-module-boundary-types': 'off',
            '@typescript-eslint/no-explicit-any': 'off',
        },
    },
    ...boundaryConfigs,
    globalIgnores(['**/.eslintrc.js', '**/eslint.config.js', '**/**.yml']),
]);
