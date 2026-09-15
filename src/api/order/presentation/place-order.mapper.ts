import { PlaceOrderCommand } from '~/api/order/application/place-order.command';
import { PlaceOrderInput } from '~/api/order/presentation/place-order.input';
import { parseGraphqlId } from '~/global/graphql/graphql-id.parser';

export function toPlaceOrderCommand(input: PlaceOrderInput): PlaceOrderCommand {
    return {
        idempotencyKey: input.idempotencyKey,
        items: input.items.map(({ itemId, quantity }) => ({
            itemId: parseGraphqlId(itemId, '상품 ID'),
            quantity,
        })),
    };
}
