export interface FulfillmentAllocationCommand {
    readonly orderItemId: bigint;
    readonly quantity: number;
}

export interface CreateFulfillmentCommand {
    readonly orderId: bigint;
    readonly idempotencyKey: string;
    readonly items: readonly FulfillmentAllocationCommand[];
}

export interface ShipFulfillmentCommand {
    readonly fulfillmentId: bigint;
    readonly carrier: string;
    readonly trackingNumber: string;
}
