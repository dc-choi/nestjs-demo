export interface PlaceOrderItemCommand {
    readonly itemId: bigint;
    readonly quantity: number;
}

export interface PlaceOrderCommand {
    readonly idempotencyKey: string;
    readonly items: readonly PlaceOrderItemCommand[];
}
