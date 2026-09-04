export class NotExistingProduct {
    readonly message = '존재하지 않는 상품입니다.';
    readonly type = 'NOT_EXISTING_PRODUCT';
}

export class ProductAccessDenied {
    readonly message = '이 상품을 변경할 권한이 없습니다.';
    readonly type = 'PRODUCT_ACCESS_DENIED';
}

export class ProductRevisionConflict {
    readonly message = '상품이 다른 요청에서 먼저 변경되었습니다.';
    readonly type = 'PRODUCT_REVISION_CONFLICT';

    constructor(
        readonly expectedRevision: number,
        readonly currentRevision: number
    ) {}
}

export class ProductWriteConflict {
    readonly message = '중복된 상품 정보가 있어 변경할 수 없습니다.';
    readonly type = 'PRODUCT_WRITE_CONFLICT';
}

export class InvalidProductChange {
    readonly type = 'INVALID_PRODUCT_CHANGE';

    constructor(readonly message: string) {}
}
