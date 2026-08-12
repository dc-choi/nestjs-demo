import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';

import { JwtClaims, JwtPayload } from '../payload/jwt.payload';

import { ExtractJwt, Strategy } from 'passport-jwt';
import { Unauthorized } from '~/global/common/error/auth.error';
import { EnvConfig } from '~/global/config/env/env.config';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
    constructor(readonly configService: ConfigService<EnvConfig, true>) {
        super({
            jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
            ignoreExpiration: false,
            secretOrKey: configService.get<string>('SECRET'),
        });
    }

    validate(claims: JwtClaims): JwtPayload {
        if (typeof claims.memberId !== 'string' || !/^\d+$/.test(claims.memberId)) {
            throw new UnauthorizedException(new Unauthorized(claims.role));
        }

        return {
            memberId: BigInt(claims.memberId),
            role: claims.role,
        };
    }
}
