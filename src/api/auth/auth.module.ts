import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';

import { AuthService } from './application/auth.service.js';
import { LoginRateLimiter } from './application/login-rate-limiter.js';
import { TokenProvider } from './infrastructure/token.provider.js';
import { AuthResolver } from './presentation/auth.resolver.js';

import { MemberEntity } from '~/api/member/domain/entity/member.entity.js';
import { PasswordModule } from '~/api/member/password.module.js';
import { EnvConfig } from '~/global/config/env/env.config.js';

@Module({
    imports: [
        MikroOrmModule.forFeature([MemberEntity]),
        PasswordModule,
        JwtModule.registerAsync({
            inject: [ConfigService],
            useFactory: async (configService: ConfigService<EnvConfig, true>) => ({
                secret: configService.get<string>('SECRET'),
                signOptions: { expiresIn: '2h' },
            }),
        }),
    ],
    providers: [AuthService, AuthResolver, LoginRateLimiter, TokenProvider],
})
export class AuthModule {}
