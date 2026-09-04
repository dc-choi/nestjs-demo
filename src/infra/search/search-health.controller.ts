import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';

import { type SearchHealthResult, SearchHealthService } from './search-health.service';

@Controller('health/search')
export class SearchHealthController {
    constructor(private readonly health: SearchHealthService) {}

    @Get()
    async check(): Promise<SearchHealthResult> {
        const result = await this.health.check();
        if (result.enabled && !result.reachable) {
            throw new ServiceUnavailableException({ message: 'OpenSearch is unavailable', search: result });
        }
        return result;
    }
}
