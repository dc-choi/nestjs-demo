import { Injectable } from '@nestjs/common';

import { OpenSearchHttpError } from '~/infra/opensearch/opensearch-http.error.js';
import { OpenSearchHttpClient } from '~/infra/opensearch/opensearch.client.js';
import { SearchConfig } from '~/infra/opensearch/search.config.js';

interface InfoResponse {
    version?: { number?: string };
    cluster_name?: string;
}

interface ClusterHealthResponse {
    status?: string;
    timed_out?: boolean;
    number_of_nodes?: number;
}

export interface SearchHealthResult {
    enabled: boolean;
    reachable: boolean;
    clusterName?: string;
    version?: string;
    status?: string;
    nodeCount?: number;
}

@Injectable()
export class SearchHealthService {
    constructor(
        private readonly config: SearchConfig,
        private readonly client: OpenSearchHttpClient
    ) {}

    async check(): Promise<SearchHealthResult> {
        if (!this.config.enabled) return { enabled: false, reachable: false };
        try {
            const [info, health] = await Promise.all([
                this.client.request<InfoResponse>('GET', '/'),
                this.client.request<ClusterHealthResponse>('GET', '/_cluster/health'),
            ]);
            return {
                enabled: true,
                reachable: !health.timed_out,
                clusterName: info.cluster_name,
                version: info.version?.number,
                status: health.status,
                nodeCount: health.number_of_nodes,
            };
        } catch (error) {
            if (error instanceof OpenSearchHttpError) return { enabled: true, reachable: false };
            throw error;
        }
    }
}
