import { BadRequestException } from '@nestjs/common';

import { invalidValue } from '~/global/common/message/error.message';

export const DECIMAL_PRODUCT_ID_PATTERN = /^[1-9]\d*$/;
export const PRODUCT_ID_MAX_LENGTH = 19;
const MAX_SIGNED_BIGINT = 9_223_372_036_854_775_807n;

export function parseProductId(value: string): bigint {
    return parseCatalogId(value, '상품 ID');
}

export function parseCatalogId(value: string, field: string): bigint {
    if (value.length > PRODUCT_ID_MAX_LENGTH || !DECIMAL_PRODUCT_ID_PATTERN.test(value)) {
        throw new BadRequestException(invalidValue(field));
    }

    const id = BigInt(value);
    if (id > MAX_SIGNED_BIGINT) throw new BadRequestException(invalidValue(field));

    return id;
}
