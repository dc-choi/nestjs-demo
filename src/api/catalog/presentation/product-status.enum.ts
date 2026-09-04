import { registerEnumType } from '@nestjs/graphql';

import { ProductStatus } from '../domain/entity/product-status';

registerEnumType(ProductStatus, {
    name: 'ProductStatus',
    description: '상품 운영 상태',
});

export { ProductStatus };
