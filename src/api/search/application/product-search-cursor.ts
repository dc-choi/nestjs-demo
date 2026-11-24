import { ProductSearchCursorError } from './product-search-cursor.error.js';

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { SearchSortValue } from '~/api/search/domain/product-search.query.js';

export interface DecodedSearchCursor {
    sessionId: string;
    sortValues: SearchSortValue[];
    fingerprint: string;
}

const CURSOR_VERSION = 1;
const CURSOR_TTL_MS = 60_000;
const MAX_CURSOR_LENGTH = 8_192;

/** Signed payload. `p` carries the port session ID. */
interface SearchCursorPayload {
    v: number;
    p: string;
    s: SearchSortValue[];
    f: string;
    e: number;
}

export function encodeSearchCursor(
    sessionId: string,
    sortValues: SearchSortValue[],
    fingerprint: string,
    secret: string,
    now = Date.now()
): string {
    const payload: SearchCursorPayload = {
        v: CURSOR_VERSION,
        p: sessionId,
        s: sortValues,
        f: fingerprint,
        e: now + CURSOR_TTL_MS,
    };
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = signCursor(encoded, secret);
    return `${encoded}.${signature}`;
}

export function decodeSearchCursor(cursor: string, secret: string, now = Date.now()): DecodedSearchCursor {
    if (cursor.length > MAX_CURSOR_LENGTH) invalidCursor();
    const parts = cursor.split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]) invalidCursor();
    const [encoded, signature] = parts as [string, string];
    const expected = signCursor(encoded, secret);
    const suppliedBytes = Buffer.from(signature, 'base64url');
    const expectedBytes = Buffer.from(expected, 'base64url');
    if (suppliedBytes.length !== expectedBytes.length || !timingSafeEqual(suppliedBytes, expectedBytes))
        invalidCursor();

    let payload: unknown;
    try {
        payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    } catch {
        invalidCursor();
    }
    if (!isSearchCursorPayload(payload)) invalidCursor();
    if (payload.e <= now) throw new ProductSearchCursorError('SEARCH_CURSOR_EXPIRED');
    return { sessionId: payload.p, sortValues: payload.s, fingerprint: payload.f };
}

export function assertSearchCursorFingerprint(cursor: DecodedSearchCursor, fingerprint: string): void {
    if (cursor.fingerprint !== fingerprint) throw new ProductSearchCursorError('SEARCH_CURSOR_MISMATCH');
}

function signCursor(encodedPayload: string, secret: string): string {
    return createHmac('sha256', secret).update(encodedPayload).digest('base64url');
}

function isSearchCursorPayload(value: unknown): value is SearchCursorPayload {
    if (!value || typeof value !== 'object') return false;
    const candidate = value as Partial<SearchCursorPayload>;
    return (
        candidate.v === CURSOR_VERSION &&
        typeof candidate.p === 'string' &&
        candidate.p.length > 0 &&
        candidate.p.length <= 4_096 &&
        typeof candidate.f === 'string' &&
        candidate.f.length > 0 &&
        candidate.f.length <= 128 &&
        Number.isSafeInteger(candidate.e) &&
        Array.isArray(candidate.s) &&
        candidate.s.length > 0 &&
        candidate.s.length <= 10 &&
        candidate.s.every(
            (entry) =>
                entry === null || typeof entry === 'string' || (typeof entry === 'number' && Number.isFinite(entry))
        )
    );
}

function invalidCursor(): never {
    throw new ProductSearchCursorError('INVALID_SEARCH_CURSOR');
}
