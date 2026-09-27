export class ProductRevisionConflict {
    readonly message = '상품이 다른 요청에서 먼저 변경되었습니다.';
    readonly type = 'PRODUCT_REVISION_CONFLICT';

    constructor(
        readonly expectedRevision: number,
        readonly currentRevision: number
    ) {}
}
