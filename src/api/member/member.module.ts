import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';

import { MemberService } from './application/member.service';
import { MemberEntity } from './domain/member.entity';
import { MemberResolver } from './presentation/member.resolver';

@Module({
    imports: [CqrsModule, MikroOrmModule.forFeature([MemberEntity])],
    providers: [MemberService, MemberResolver],
})
export class MemberModule {}
