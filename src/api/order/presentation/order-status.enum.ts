import { registerEnumType } from '@nestjs/graphql';

import { OrderStatus } from '~/api/order/domain/entity/order.enum';

registerEnumType(OrderStatus, {
    name: 'OrderStatus',
});

export { OrderStatus };
