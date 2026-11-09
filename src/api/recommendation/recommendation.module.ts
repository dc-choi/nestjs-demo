import { Module } from '@nestjs/common';

import { RecommendationCandidateService } from './application/recommendation-candidate.service';
import { RecommendationProfileReader } from './infrastructure/recommendation-profile.reader';

import { SearchModule } from '~/infra/search/search.module';

/** Internal candidate retrieval. The GraphQL recommendation API is a later stage. */
@Module({
    imports: [SearchModule],
    providers: [RecommendationProfileReader, RecommendationCandidateService],
    exports: [RecommendationCandidateService],
})
export class RecommendationModule {}
