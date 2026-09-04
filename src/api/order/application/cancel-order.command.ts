export interface CancelOrderCommand {
    readonly orderId: bigint;
    readonly idempotencyKey: string;
    readonly reason?: string | null;
}
