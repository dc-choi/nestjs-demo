export class InvalidProductChange {
    readonly type = 'INVALID_PRODUCT_CHANGE';

    constructor(readonly message: string) {}
}
