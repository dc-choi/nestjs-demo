import { registerEnumType } from '@nestjs/graphql';

import { ProductSnapshotChangeType } from '../domain/entity/product-snapshot-change-type';

registerEnumType(ProductSnapshotChangeType, {
    name: 'ProductSnapshotChangeType',
    description: '상품 Snapshot 변경 유형',
});

export { ProductSnapshotChangeType };
