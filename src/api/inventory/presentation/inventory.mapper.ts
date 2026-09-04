import type { InventoryTransitionResult } from '~/api/inventory/application/inventory.service';
import type { InventoryMovementEntity } from '~/api/inventory/domain/inventory-movement.entity';
import type {
    InventoryAdjustmentPayload,
    InventoryMovementType,
    InventoryTransitionPayload,
} from '~/api/inventory/presentation/inventory.type';

export function toInventoryTransitionPayload(result: InventoryTransitionResult): InventoryTransitionPayload {
    const { reservation, movement } = result;
    if (reservation.id == null) throw new Error('저장되지 않은 재고 예약입니다.');

    return {
        reservation: {
            id: reservation.id.toString(),
            orderItemId: reservation.orderItem.id.toString(),
            itemId: reservation.orderItem.item.id.toString(),
            quantity: reservation.quantity,
            status: reservation.status,
            expiresAt: reservation.expiresAt,
            consumedAt: reservation.consumedAt,
            releasedAt: reservation.releasedAt,
        },
        movement: movement ? toInventoryMovementType(movement) : null,
    };
}

export function toInventoryAdjustmentPayload(movement: InventoryMovementEntity): InventoryAdjustmentPayload {
    return { movement: toInventoryMovementType(movement) };
}

function toInventoryMovementType(movement: InventoryMovementEntity): InventoryMovementType {
    if (movement.id == null) throw new Error('저장되지 않은 재고 원장입니다.');
    return {
        id: movement.id.toString(),
        type: movement.type,
        quantityDelta: movement.quantityDelta,
        stockAfter: movement.stockAfter,
        itemSku: movement.itemSku,
    };
}
