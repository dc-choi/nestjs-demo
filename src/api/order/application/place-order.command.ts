export interface PlaceOrderItemCommand {
    readonly itemId: bigint;
    readonly quantity: number;
}

export interface PlaceOrderCommand {
    readonly items: readonly PlaceOrderItemCommand[];
}
