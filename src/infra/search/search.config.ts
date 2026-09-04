import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const ALIAS_PATTERN = /^[a-z0-9][a-z0-9_-]{0,254}$/;

@Injectable()
export class SearchConfig {
    readonly enabled: boolean;
    readonly nodeUrl: URL;
    readonly readAlias: string;
    readonly writeAlias: string;
    readonly cursorSecret: string;
    readonly requestTimeoutMs: number;

    constructor(config: ConfigService) {
        this.enabled = parseBoolean(config.get<unknown>('OPENSEARCH_ENABLED'), false);
        this.nodeUrl = parseNodeUrl(config.get<unknown>('OPENSEARCH_NODE_URL'), this.enabled);
        this.readAlias = parseAlias(
            config.get<unknown>('OPENSEARCH_READ_ALIAS'),
            'catalog-products-read',
            this.enabled
        );
        this.writeAlias = parseAlias(
            config.get<unknown>('OPENSEARCH_WRITE_ALIAS'),
            'catalog-products-write',
            this.enabled
        );
        if (this.enabled && this.readAlias === this.writeAlias) {
            throw new Error('OpenSearch read and write aliases must be different');
        }
        this.cursorSecret = parseCursorSecret(
            config.get<unknown>('OPENSEARCH_CURSOR_SECRET') ?? config.get<unknown>('SECRET'),
            this.enabled
        );
        this.requestTimeoutMs = parseTimeout(config.get<unknown>('OPENSEARCH_REQUEST_TIMEOUT_MS'));
    }
}

function parseBoolean(value: unknown, fallback: boolean): boolean {
    if (value === undefined || value === null || value === '') return fallback;
    if (value === true || value === 'true') return true;
    if (value === false || value === 'false') return false;
    throw new Error('OPENSEARCH_ENABLED must be true or false');
}

function parseNodeUrl(value: unknown, required: boolean): URL {
    if (typeof value !== 'string' || value.trim() === '') {
        if (required) throw new Error('OPENSEARCH_NODE_URL is required when OpenSearch is enabled');
        return new URL('http://127.0.0.1:9200');
    }

    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
        throw new Error('OPENSEARCH_NODE_URL must be an HTTP(S) origin without credentials, query, or fragment');
    }
    if (url.pathname !== '/' && url.pathname !== '') throw new Error('OPENSEARCH_NODE_URL must not include a path');
    return url;
}

function parseAlias(value: unknown, fallback: string, required: boolean): string {
    if (typeof value !== 'string' || value.trim() === '') {
        if (required) throw new Error(`${fallback} alias environment value is required when OpenSearch is enabled`);
        return fallback;
    }

    const alias = value.trim();
    if (!ALIAS_PATTERN.test(alias)) throw new Error(`Invalid OpenSearch alias: ${alias}`);
    return alias;
}

function parseCursorSecret(value: unknown, required: boolean): string {
    if (typeof value === 'string' && value.length >= 32) return value;
    if (required) {
        throw new Error(
            'OPENSEARCH_CURSOR_SECRET or SECRET must contain at least 32 characters when OpenSearch is enabled'
        );
    }
    if (typeof value === 'string' && value.length > 0) return value;
    return 'search-disabled';
}

function parseTimeout(value: unknown): number {
    if (value === undefined || value === null || value === '') return 2_000;
    const timeout = typeof value === 'number' ? value : Number(value);
    if (!Number.isInteger(timeout) || timeout < 100 || timeout > 30_000) {
        throw new Error('OPENSEARCH_REQUEST_TIMEOUT_MS must be an integer between 100 and 30000');
    }
    return timeout;
}
