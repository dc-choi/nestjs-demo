import type { FulfillmentEntity } from '~/api/fulfillment/domain/fulfillment.entity';
import type { FulfillmentPayload } from '~/api/fulfillment/presentation/fulfillment.type';

export function toFulfillmentPayload(fulfillment: FulfillmentEntity): FulfillmentPayload {
    if (fulfillment.id == null) throw new Error('저장되지 않은 배송입니다.');

    return {
        fulfillment: {
            id: fulfillment.id.toString(),
            orderId: fulfillment.order.id.toString(),
            status: fulfillment.status,
            carrier: fulfillment.carrier,
            trackingNumber: fulfillment.trackingNumber,
            packedAt: fulfillment.packedAt,
            shippedAt: fulfillment.shippedAt,
            deliveredAt: fulfillment.deliveredAt,
            cancelledAt: fulfillment.cancelledAt,
            items: fulfillment.items.getItems().map((item) => ({
                id: item.id.toString(),
                orderItemId: item.orderItem.id.toString(),
                quantity: item.quantity,
            })),
        },
    };
}
