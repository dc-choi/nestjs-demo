import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';

import { JwtClaims, JwtPayload } from '../payload/jwt.payload.js';

import { ExtractJwt, Strategy } from 'passport-jwt';
import { EnvConfig } from '~/global/config/env/env.config.js';
import { Unauthorized } from '~/global/jwt/error/unauthorized.error.js';
import { resolveJwtSecret } from '~/global/jwt/jwt-secret.js';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
    constructor(readonly configService: ConfigService<EnvConfig, true>) {
        super({
            jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
            ignoreExpiration: false,
            secretOrKey: resolveJwtSecret(configService),
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
