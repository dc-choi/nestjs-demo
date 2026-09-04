const MONEY_PATTERN = /^(\d+)(?:\.(\d{1,3}))?$/;

interface MoneyParts {
    readonly coefficient: bigint;
    readonly scale: number;
}

export function assertPositiveMoney(amount: string): void {
    const { coefficient } = parseMoney(amount);
    if (coefficient <= 0n) throw new RangeError('금액은 0보다 커야 합니다.');
}

export function sumMoney(amounts: readonly string[]): string {
    const parts = amounts.map(parseMoney);
    const scale = Math.max(0, ...parts.map((part) => part.scale));
    const coefficient = parts.reduce((sum, part) => sum + part.coefficient * 10n ** BigInt(scale - part.scale), 0n);

    return formatMoney(coefficient, scale);
}

export function compareMoney(left: string, right: string): number {
    const [leftParts, rightParts] = [parseMoney(left), parseMoney(right)];
    const scale = Math.max(leftParts.scale, rightParts.scale);
    const normalizedLeft = leftParts.coefficient * 10n ** BigInt(scale - leftParts.scale);
    const normalizedRight = rightParts.coefficient * 10n ** BigInt(scale - rightParts.scale);

    return normalizedLeft < normalizedRight ? -1 : normalizedLeft > normalizedRight ? 1 : 0;
}

function parseMoney(amount: string): MoneyParts {
    const match = MONEY_PATTERN.exec(amount);
    if (!match) throw new TypeError('금액은 소수점 이하 3자리 이내의 양수 형식이어야 합니다.');

    const [, integer, fraction = ''] = match;
    return { coefficient: BigInt(`${integer}${fraction}`), scale: fraction.length };
}

function formatMoney(coefficient: bigint, scale: number): string {
    const digits = coefficient.toString().padStart(scale + 1, '0');
    const integer = scale === 0 ? digits : digits.slice(0, -scale);
    const fraction = scale === 0 ? '' : digits.slice(-scale).replace(/0+$/, '');
    return fraction ? `${integer}.${fraction}` : integer;
}
