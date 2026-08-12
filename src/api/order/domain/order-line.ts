import { multiplyDecimal } from '~/api/order/domain/decimal';

export interface SelectedOrderOption {
    readonly optionCode: string;
    readonly optionName: string;
    readonly valueCode: string;
    readonly valueName: string;
}

export interface OrderLineSnapshot {
    readonly productSnapshotId: bigint;
    readonly productName: string;
    readonly itemName: string;
    readonly itemSku: string;
    readonly productDescription: string | null;
    readonly productReturnPolicy: string | null;
    readonly unitSupplyPrice: string;
    readonly unitVat: string;
    readonly unitTotalPrice: string;
    readonly isTaxFree: boolean;
    readonly selectedOptions: readonly SelectedOrderOption[];
}

interface CreateOrderLine {
    readonly itemId: bigint;
    readonly quantity: number;
    readonly snapshot: OrderLineSnapshot;
}

export class OrderLine {
    private constructor(
        readonly id: bigint | null,
        readonly itemId: bigint,
        readonly quantity: number,
        readonly lineTotalPrice: string,
        readonly snapshot: OrderLineSnapshot
    ) {}

    static create({ itemId, quantity, snapshot }: CreateOrderLine): OrderLine {
        return new OrderLine(null, itemId, quantity, multiplyDecimal(snapshot.unitTotalPrice, quantity), {
            ...snapshot,
            selectedOptions: snapshot.selectedOptions.map((option) => ({ ...option })),
        });
    }

    withId(id: bigint): OrderLine {
        return new OrderLine(id, this.itemId, this.quantity, this.lineTotalPrice, this.snapshot);
    }
}
