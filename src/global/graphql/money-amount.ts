const MONEY_AMOUNT_PATTERN = /^(-?\d+)(?:\.(\d{1,3}))?$/;

/** 공개 `Money.amount`를 DB `decimal(…,3)` 값과 같은 소수 셋째 자리 표기로 맞춘다. 예: `'2200'`은 `'2200.000'`. */
export function formatMoneyAmount(amount: string): string {
    const match = MONEY_AMOUNT_PATTERN.exec(amount);
    if (!match) throw new RangeError(`금액은 소수점 이하 3자리 이내의 숫자 형식이어야 합니다: ${amount}`);

    const [, integer, fraction = ''] = match;
    // 선행 0도 정규화해야 입력 문자열을 그대로 담은 거래와 DB에서 다시 읽은 거래의 표기가 같다.
    return `${BigInt(integer)}.${fraction.padEnd(3, '0')}`;
}
