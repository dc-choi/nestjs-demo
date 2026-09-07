import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Module } from '@nestjs/common';

import { AuthService } from './application/auth.service';
import { LoginRateLimiter } from './application/login-rate-limiter';
import { AuthResolver } from './presentation/auth.resolver';

import { MemberEntity } from '~/api/member/domain/member.entity';
import { PasswordModule } from '~/api/member/password.module';
import { TokenModule } from '~/global/jwt/token.module';

@Module({
    imports: [MikroOrmModule.forFeature([MemberEntity]), PasswordModule, TokenModule],
    providers: [AuthService, AuthResolver, LoginRateLimiter],
})
export class AuthModule {}
