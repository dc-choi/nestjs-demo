import { Module } from '@nestjs/common';

import { RecommendationCandidateService } from './application/recommendation-candidate.service.js';
import { RecommendationProfileReader } from './infrastructure/recommendation-profile.reader.js';

import { OpenSearchModule } from '~/infra/opensearch/opensearch.module.js';

/** Internal candidate retrieval. The GraphQL recommendation API is a later stage. */
@Module({
    imports: [OpenSearchModule],
    providers: [RecommendationProfileReader, RecommendationCandidateService],
    exports: [RecommendationCandidateService],
})
export class RecommendationModule {}
