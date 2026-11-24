import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';

import { JwtStrategy } from './strategy/jwt.strategy.js';
import { TokenProvider } from './token.provider.js';

import { EnvConfig } from '~/global/config/env/env.config.js';

@Module({
    imports: [
        JwtModule.registerAsync({
            inject: [ConfigService],
            useFactory: async (configService: ConfigService<EnvConfig, true>) => ({
                secret: configService.get<string>('SECRET'),
                signOptions: { expiresIn: '2h' },
            }),
        }),
    ],
    providers: [TokenProvider, JwtStrategy],
    exports: [TokenProvider],
})
export class TokenModule {}
