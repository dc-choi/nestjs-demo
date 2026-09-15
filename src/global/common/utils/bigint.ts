/** Total order for bigint IDs, usable as an Array sort comparator. */
export function compareBigInt(left: bigint, right: bigint): number {
    if (left === right) return 0;
    return left < right ? -1 : 1;
}
