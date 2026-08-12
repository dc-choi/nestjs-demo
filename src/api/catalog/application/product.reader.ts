import { ProductReadResult } from './product-read.result';

export const PRODUCT_READER = Symbol('PRODUCT_READER');

export interface ProductReader {
    findCurrentById(productId: bigint): Promise<ProductReadResult | null>;
}
