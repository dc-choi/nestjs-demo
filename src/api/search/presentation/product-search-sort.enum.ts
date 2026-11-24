import { registerEnumType } from '@nestjs/graphql';

import { ProductSearchSort } from '~/api/search/domain/product-search-sort.js';

registerEnumType(ProductSearchSort, { name: 'ProductSearchSort' });

export { ProductSearchSort };
