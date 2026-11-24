export class InvalidProductSnapshotLimit {
    readonly type = 'INVALID_PRODUCT_CHANGE';
    readonly message: string;

    constructor(maxLimit: number) {
        this.message = `Snapshot limit은 1~${maxLimit}입니다.`;
    }
}
