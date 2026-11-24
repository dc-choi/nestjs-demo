import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';

import { AuthService } from './application/auth.service.js';
import { LoginRateLimiter } from './infrastructure/login-rate.limiter.js';
import { TokenProvider } from './infrastructure/token.provider.js';
import { AuthResolver } from './presentation/auth.resolver.js';

import { MemberEntity } from '~/api/member/domain/entity/member.entity.js';
import { MemberModule } from '~/api/member/member.module.js';
import { PasswordModule } from '~/api/member/password.module.js';
import { EnvConfig } from '~/global/config/env/env.config.js';
import { resolveJwtSecret } from '~/global/jwt/jwt-secret.js';

@Module({
    imports: [
        MikroOrmModule.forFeature([MemberEntity]),
        MemberModule,
        PasswordModule,
        JwtModule.registerAsync({
            inject: [ConfigService],
            useFactory: async (configService: ConfigService<EnvConfig, true>) => ({
                secret: resolveJwtSecret(configService),
                signOptions: { expiresIn: '2h' },
            }),
        }),
    ],
    providers: [AuthService, AuthResolver, LoginRateLimiter, TokenProvider],
})
export class AuthModule {}
