import { Injectable } from '@nestjs/common';

import { SearchConfig } from './search.config';

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';
type QueryValue = string | number | boolean;

export interface OpenSearchRequestOptions {
    query?: Readonly<Record<string, QueryValue | undefined>>;
    body?: unknown;
    ndjson?: string;
    acceptedStatuses?: readonly number[];
    timeoutMs?: number;
}

export class OpenSearchHttpError extends Error {
    constructor(
        readonly status: number | null,
        readonly responseBody: unknown,
        message: string,
        options?: ErrorOptions
    ) {
        super(message, options);
        this.name = OpenSearchHttpError.name;
    }

    get isNotFound(): boolean {
        return this.status === 404;
    }
}

@Injectable()
export class OpenSearchHttpClient {
    constructor(private readonly config: SearchConfig) {}

    async request<T>(method: HttpMethod, path: string, options: OpenSearchRequestOptions = {}): Promise<T> {
        if (!this.config.enabled) throw new OpenSearchHttpError(null, null, 'OpenSearch is disabled');
        if (!path.startsWith('/') || path.startsWith('//')) throw new Error(`Invalid OpenSearch path: ${path}`);
        if (options.body !== undefined && options.ndjson !== undefined) {
            throw new Error('OpenSearch request cannot contain both JSON and NDJSON bodies');
        }

        const url = new URL(path.slice(1), this.config.nodeUrl);
        for (const [key, value] of Object.entries(options.query ?? {})) {
            if (value !== undefined) url.searchParams.set(key, String(value));
        }

        const headers = new Headers({ accept: 'application/json' });
        let body: string | undefined;
        if (options.ndjson !== undefined) {
            headers.set('content-type', 'application/x-ndjson');
            body = options.ndjson.endsWith('\n') ? options.ndjson : `${options.ndjson}\n`;
        } else if (options.body !== undefined) {
            headers.set('content-type', 'application/json');
            body = JSON.stringify(options.body);
        }

        let response: Response;
        try {
            response = await fetch(url, {
                method,
                headers,
                body,
                signal: AbortSignal.timeout(options.timeoutMs ?? this.config.requestTimeoutMs),
            });
        } catch (error) {
            throw new OpenSearchHttpError(null, null, `OpenSearch ${method} ${path} failed`, { cause: error });
        }

        const responseBody = await parseResponseBody(response);
        const accepted = response.ok || options.acceptedStatuses?.includes(response.status);
        if (!accepted) {
            throw new OpenSearchHttpError(
                response.status,
                responseBody,
                `OpenSearch ${method} ${path} returned HTTP ${response.status}`
            );
        }
        return responseBody as T;
    }
}

async function parseResponseBody(response: Response): Promise<unknown> {
    const text = await response.text();
    if (text === '') return null;

    try {
        return JSON.parse(text);
    } catch {
        return text.slice(0, 4_096);
    }
}

export function escapeOpenSearchPathSegment(value: string): string {
    return encodeURIComponent(value);
}
