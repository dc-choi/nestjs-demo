import { FulfillmentConflict } from '~/api/fulfillment/domain/fulfillment-conflict.error.js';
import { OrderCancellationConflict } from '~/api/order/domain/order-cancellation-conflict.error.js';
import { OrderTransitionConflict } from '~/api/order/domain/order-transition-conflict.error.js';
import { PaymentAttemptConflict } from '~/api/payment/domain/payment-attempt-conflict.error.js';

/** 주문 취소와 만료가 연쇄로 부르는 결제 시도, 배송, 주문 전이의 충돌을 한 번에 판정한다. */
export function isOrderCancellationConflict(error: unknown): error is Error {
    return (
        error instanceof OrderCancellationConflict ||
        error instanceof OrderTransitionConflict ||
        error instanceof PaymentAttemptConflict ||
        error instanceof FulfillmentConflict
    );
}
