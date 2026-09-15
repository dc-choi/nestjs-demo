import { BadRequestException } from '@nestjs/common';

import { describe, expect, it } from 'vitest';
import { parseGraphqlId } from '~/global/graphql/graphql-id.parser';

describe('parseGraphqlId', () => {
    it('GraphQL ID 문자열을 bigint로 변환한다', () => {
        expect(parseGraphqlId('1', '상품 ID')).toBe(1n);
        expect(parseGraphqlId('9223372036854775807', '상품 ID')).toBe(9_223_372_036_854_775_807n);
    });

    it.each(['0', '-1', '1.5', '01', '', '9223372036854775808', '12345678901234567890'])(
        '유효하지 않은 ID %s를 거부한다',
        (id) => {
            expect(() => parseGraphqlId(id, '상품 ID')).toThrow(BadRequestException);
        }
    );

    it('거부 메시지에 필드 이름을 담는다', () => {
        expect(() => parseGraphqlId('x', '재고 예약 ID')).toThrow("'재고 예약 ID'이(가) 올바르지 않습니다.");
    });
});
