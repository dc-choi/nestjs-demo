import { BadRequestException } from '@nestjs/common';

import { PlaceOrderCommand } from '~/api/order/application/place-order.command';
import { DECIMAL_ITEM_ID_PATTERN } from '~/api/order/presentation/place-order-item.input';
import { PlaceOrderInput } from '~/api/order/presentation/place-order.input';
import { invalidValue } from '~/global/common/message/error.message';

const MAX_SIGNED_BIGINT = 9_223_372_036_854_775_807n;

export function toPlaceOrderCommand(input: PlaceOrderInput): PlaceOrderCommand {
    return {
        items: input.items.map(({ itemId, quantity }) => ({
            itemId: parseItemId(itemId),
            quantity,
        })),
    };
}

function parseItemId(value: string): bigint {
    if (value.length > 19 || !DECIMAL_ITEM_ID_PATTERN.test(value)) {
        throw new BadRequestException(invalidValue('상품 ID'));
    }

    const itemId = BigInt(value);
    if (itemId > MAX_SIGNED_BIGINT) throw new BadRequestException(invalidValue('상품 ID'));

    return itemId;
}
