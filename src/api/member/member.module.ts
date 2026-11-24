import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';

import { MemberService } from './application/member.service.js';
import { MemberEntity } from './domain/entity/member.entity.js';
import { PasswordModule } from './password.module.js';
import { MemberResolver } from './presentation/member.resolver.js';

@Module({
    imports: [CqrsModule, MikroOrmModule.forFeature([MemberEntity]), PasswordModule],
    providers: [MemberService, MemberResolver],
    exports: [MemberService],
})
export class MemberModule {}
