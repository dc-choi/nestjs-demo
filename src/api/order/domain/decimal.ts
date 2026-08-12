const DECIMAL_PATTERN = /^(-?)(\d+)(?:\.(\d+))?$/;

interface DecimalParts {
    coefficient: bigint;
    scale: number;
}

export function multiplyDecimal(amount: string, multiplier: number): string {
    if (!Number.isSafeInteger(multiplier) || multiplier < 1) {
        throw new RangeError('수량은 1 이상의 안전한 정수여야 합니다.');
    }

    const { coefficient, scale } = parseDecimal(amount);
    return formatDecimal(coefficient * BigInt(multiplier), scale);
}

export function sumDecimals(amounts: readonly string[]): string {
    let total: DecimalParts = { coefficient: 0n, scale: 0 };

    for (const amount of amounts) {
        total = addDecimalParts(total, parseDecimal(amount));
    }

    return formatDecimal(total.coefficient, total.scale);
}

function parseDecimal(amount: string): DecimalParts {
    const match = DECIMAL_PATTERN.exec(amount);
    if (!match) throw new TypeError(`유효하지 않은 금액입니다: ${amount}`);

    const [, sign, integer, fraction = ''] = match;
    const coefficient = BigInt(`${sign}${integer}${fraction}`);

    return { coefficient, scale: fraction.length };
}

function addDecimalParts(left: DecimalParts, right: DecimalParts): DecimalParts {
    const scale = Math.max(left.scale, right.scale);

    return {
        coefficient:
            left.coefficient * 10n ** BigInt(scale - left.scale) +
            right.coefficient * 10n ** BigInt(scale - right.scale),
        scale,
    };
}

function formatDecimal(coefficient: bigint, scale: number): string {
    const negative = coefficient < 0n;
    const digits = (negative ? -coefficient : coefficient).toString().padStart(scale + 1, '0');
    const integer = scale === 0 ? digits : digits.slice(0, -scale);
    const fraction = scale === 0 ? '' : digits.slice(-scale).replace(/0+$/, '');
    const value = fraction ? `${integer}.${fraction}` : integer;

    return negative && value !== '0' ? `-${value}` : value;
}
