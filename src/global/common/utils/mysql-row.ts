/**
 * Coercions for raw rows returned by `EntityManager.execute`. The MySQL driver may hand back numbers,
 * strings or bigints depending on the column and query, so every field is checked before use.
 */

export function toBigInt(value: unknown, field: string): bigint {
    const normalized = typeof value === 'bigint' ? value.toString() : String(value);
    if (!/^\d+$/.test(normalized)) throw new Error(`Invalid ${field}`);
    return BigInt(normalized);
}

export function toNonNegativeInteger(value: unknown, field: string): number {
    const normalized = typeof value === 'number' ? value : Number(value);
    if (!Number.isSafeInteger(normalized) || normalized < 0) throw new Error(`Invalid ${field}`);
    return normalized;
}

export function toRequiredString(value: unknown, field: string): string {
    if (typeof value !== 'string' || value.length === 0) throw new Error(`Invalid ${field}`);
    return value;
}

export function toNullableString(value: unknown, field: string): string | null {
    if (value === null || value === undefined) return null;
    if (typeof value !== 'string') throw new Error(`Invalid ${field}`);
    return value;
}
