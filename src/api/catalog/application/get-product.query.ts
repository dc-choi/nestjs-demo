import { Inject, Injectable } from '@nestjs/common';

import { ProductReadResult } from './product-read.result';
import { PRODUCT_READER, ProductReader } from './product.reader';

@Injectable()
export class GetProductQuery {
    constructor(@Inject(PRODUCT_READER) private readonly productReader: ProductReader) {}

    execute(productId: bigint): Promise<ProductReadResult | null> {
        return this.productReader.findCurrentById(productId);
    }
}
