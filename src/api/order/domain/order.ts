import { sumDecimals } from '~/api/order/domain/decimal';
import { OrderLine } from '~/api/order/domain/order-line';

export const OrderStatus = {
    PENDING: 'PENDING',
    CONFIRMED: 'CONFIRMED',
    CANCELLED: 'CANCELLED',
    COMPLETED: 'COMPLETED',
} as const;

export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];

interface PlaceOrder {
    readonly memberId: bigint;
    readonly orderNumber: string;
    readonly currencyCode: string;
    readonly items: readonly OrderLine[];
}

interface PersistOrder {
    readonly id: bigint;
    readonly status: OrderStatus;
    readonly createdAt: Date;
    readonly itemIds: readonly bigint[];
}

export class Order {
    private constructor(
        readonly id: bigint | null,
        readonly memberId: bigint,
        readonly orderNumber: string,
        readonly status: OrderStatus,
        readonly currencyCode: string,
        readonly totalPrice: string,
        readonly createdAt: Date | null,
        readonly items: readonly OrderLine[]
    ) {}

    static place({ memberId, orderNumber, currencyCode, items }: PlaceOrder): Order {
        if (items.length === 0) throw new RangeError('주문 품목은 하나 이상이어야 합니다.');
        if (!/^[A-Z]{3}$/.test(currencyCode)) throw new TypeError('통화 코드는 ISO 4217 형식이어야 합니다.');

        return new Order(
            null,
            memberId,
            orderNumber,
            OrderStatus.PENDING,
            currencyCode,
            sumDecimals(items.map(({ lineTotalPrice }) => lineTotalPrice)),
            null,
            [...items]
        );
    }

    persisted({ id, status, createdAt, itemIds }: PersistOrder): Order {
        if (itemIds.length !== this.items.length) {
            throw new Error('저장된 주문 품목 수가 요청한 품목 수와 일치하지 않습니다.');
        }

        return new Order(
            id,
            this.memberId,
            this.orderNumber,
            status,
            this.currencyCode,
            this.totalPrice,
            createdAt,
            this.items.map((item, index) => item.withId(itemIds[index]))
        );
    }
}
