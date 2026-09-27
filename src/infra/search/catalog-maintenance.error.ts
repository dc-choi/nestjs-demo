import { ServiceUnavailableException } from '@nestjs/common';

export class CatalogMaintenanceError extends ServiceUnavailableException {
    constructor() {
        super('상품 검색 인덱스를 재구축하고 있습니다. 잠시 후 다시 시도해 주세요.');
    }
}
