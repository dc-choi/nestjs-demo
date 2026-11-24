import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Module } from '@nestjs/common';

import { AuthService } from './application/auth.service.js';
import { LoginRateLimiter } from './application/login-rate-limiter.js';
import { AuthResolver } from './presentation/auth.resolver.js';

import { MemberEntity } from '~/api/member/domain/member.entity.js';
import { PasswordModule } from '~/api/member/password.module.js';
import { TokenModule } from '~/global/jwt/token.module.js';

@Module({
    imports: [MikroOrmModule.forFeature([MemberEntity]), PasswordModule, TokenModule],
    providers: [AuthService, AuthResolver, LoginRateLimiter],
})
export class AuthModule {}
