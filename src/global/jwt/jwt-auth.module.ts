import { Module } from '@nestjs/common';

import { JwtStrategy } from './strategy/jwt.strategy.js';

/** Registers the passport JWT strategy that every guarded resolver uses. Token issuing lives in AuthModule. */
@Module({
    providers: [JwtStrategy],
})
export class JwtAuthModule {}
