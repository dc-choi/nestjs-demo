export const MYSQL_SIGNED_INT_MIN = -2_147_483_648;
export const MYSQL_SIGNED_INT_MAX = 2_147_483_647;

export function isMysqlSignedInt(value: number): boolean {
    return Number.isInteger(value) && value >= MYSQL_SIGNED_INT_MIN && value <= MYSQL_SIGNED_INT_MAX;
}

export function isNonNegativeMysqlSignedInt(value: number): boolean {
    return isMysqlSignedInt(value) && value >= 0;
}

export function isPositiveMysqlSignedInt(value: number): boolean {
    return isMysqlSignedInt(value) && value >= 1;
}
