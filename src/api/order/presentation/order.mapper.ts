import { OrderItemEntity } from '~/api/order/domain/entity/order-item.entity';
import { OrderEntity } from '~/api/order/domain/entity/order.entity';
import { OrderItemType } from '~/api/order/presentation/order-item.type';
import { OrderType } from '~/api/order/presentation/order.type';

export function toOrderType(order: OrderEntity): OrderType {
    if (order.id == null || order.createdAt == null) {
        throw new Error('저장되지 않은 주문은 GraphQL 응답으로 변환할 수 없습니다.');
    }

    return {
        id: order.id.toString(),
        orderNumber: order.orderNumber,
        status: order.status,
        currencyCode: order.currencyCode,
        totalPrice: toMoney(order.totalPrice, order.currencyCode),
        createdAt: order.createdAt,
        items: order.items.getItems().map((item) => toOrderItemType(item, order.currencyCode)),
    };
}

function toOrderItemType(item: OrderItemEntity, currencyCode: string): OrderItemType {
    if (item.id == null) throw new Error('저장되지 않은 주문 품목은 GraphQL 응답으로 변환할 수 없습니다.');
    if (!item.snapshot) throw new Error('주문 품목 Snapshot이 없습니다.');

    const { snapshot } = item;

    return {
        id: item.id.toString(),
        itemId: item.item.id.toString(),
        quantity: item.quantity,
        lineTotalPrice: toMoney(item.lineTotalPrice, currencyCode),
        snapshot: {
            productId: snapshot.sourceProductId.toString(),
            productRevision: snapshot.sourceProductRevision,
            productName: snapshot.productName,
            itemName: snapshot.itemName,
            itemSku: snapshot.itemSku,
            productDescription: snapshot.productDescription,
            productReturnPolicy: snapshot.productReturnPolicy,
            unitSupplyPrice: toMoney(snapshot.unitSupplyPrice, currencyCode),
            unitVat: toMoney(snapshot.unitVat, currencyCode),
            unitTotalPrice: toMoney(snapshot.unitTotalPrice, currencyCode),
            isTaxFree: snapshot.isTaxFree,
            selectedOptions: snapshot.selectedOptions.map((option) => ({ ...option })),
        },
    };
}

function toMoney(amount: string, currencyCode: string) {
    return { amount, currencyCode };
}
