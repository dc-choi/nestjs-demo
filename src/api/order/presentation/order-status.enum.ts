import { registerEnumType } from '@nestjs/graphql';

import { OrderStatus } from '~/api/order/domain/order';

registerEnumType(OrderStatus, {
    name: 'OrderStatus',
});

export { OrderStatus };
