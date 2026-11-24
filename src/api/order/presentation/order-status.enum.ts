import { registerEnumType } from '@nestjs/graphql';

import { OrderStatus } from '~/api/order/domain/entity/order-status.js';

registerEnumType(OrderStatus, {
    name: 'OrderStatus',
});

export { OrderStatus };
