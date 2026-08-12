import { BadRequestException } from '@nestjs/common';

import { invalidValue } from '~/global/common/message/error.message';

const DECIMAL_PRODUCT_ID_PATTERN = /^[1-9]\d*$/;
const MAX_SIGNED_BIGINT = 9_223_372_036_854_775_807n;

export function parseProductId(value: string): bigint {
    if (value.length > 19 || !DECIMAL_PRODUCT_ID_PATTERN.test(value)) {
        throw new BadRequestException(invalidValue('상품 ID'));
    }

    const productId = BigInt(value);
    if (productId > MAX_SIGNED_BIGINT) throw new BadRequestException(invalidValue('상품 ID'));

    return productId;
}
