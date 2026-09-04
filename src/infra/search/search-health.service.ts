import { Injectable } from '@nestjs/common';

import { OpenSearchHttpClient, OpenSearchHttpError } from './opensearch.client';
import { SearchConfig } from './search.config';

interface InfoResponse {
    version?: { number?: string };
    cluster_name?: string;
}

interface ClusterHealthResponse {
    status?: string;
    timed_out?: boolean;
    number_of_nodes?: number;
}

interface AnalyzeResponse {
    tokens?: Array<{ token?: string }>;
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

    async verifyNoriAnalyzer(): Promise<string[]> {
        if (!this.config.enabled) throw new Error('OpenSearch is disabled');
        const plugins = await this.client.request<Array<{ component?: string }>>('GET', '/_cat/plugins', {
            query: { format: 'json' },
        });
        if (!Array.isArray(plugins) || !plugins.some(({ component }) => component === 'analysis-nori')) {
            throw new Error('OpenSearch analysis-nori plugin is not installed');
        }
        const analysis = await this.client.request<AnalyzeResponse>('POST', '/_analyze', {
            body: { tokenizer: 'nori_tokenizer', text: '무선 기계식 키보드' },
        });
        if (!Array.isArray(analysis.tokens)) throw new Error('OpenSearch Nori analysis did not return tokens');
        const tokens = analysis.tokens
            .map(({ token }) => token)
            .filter((token): token is string => typeof token === 'string');
        if (tokens.length === 0) throw new Error('OpenSearch Nori analysis returned no tokens');
        return tokens;
    }
}
