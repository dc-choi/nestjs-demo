import { registerEnumType } from '@nestjs/graphql';

import { ItemSaleStatus } from '../domain/entity/item-sale-status.js';

registerEnumType(ItemSaleStatus, {
    name: 'ItemSaleStatus',
    description: 'Item 판매 상태',
});

export { ItemSaleStatus };
