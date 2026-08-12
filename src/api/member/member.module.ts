import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';

import { MemberService } from './application/member.service';
import { MemberResolver } from './presentation/member.resolver';

@Module({
    imports: [CqrsModule],
    providers: [MemberService, MemberResolver],
})
export class MemberModule {}
