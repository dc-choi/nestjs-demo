import { BadRequestException } from '@nestjs/common';

import { parseProductId } from '~/api/catalog/presentation/product-id.parser';

describe('parseProductId', () => {
    it('GraphQL ID 문자열을 bigint로 변환한다', () => {
        expect(parseProductId('9223372036854775807')).toBe(9_223_372_036_854_775_807n);
    });

    it.each(['0', '-1', '1.5', '9223372036854775808'])('유효하지 않은 상품 ID %s를 거부한다', (id) => {
        expect(() => parseProductId(id)).toThrow(BadRequestException);
    });
});
