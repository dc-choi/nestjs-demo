import { Args, Context, Mutation, Resolver } from '@nestjs/graphql';

import { AuthService } from '../application/auth.service.js';
import { LoginRateLimiter } from '../application/login-rate-limiter.js';
import { LoginInput } from './login.input.js';
import { LoginPayload } from './login.payload.js';
import { RefreshTokenInput } from './refresh-token.input.js';
import { RefreshTokenPayload } from './refresh-token.payload.js';

import type { GraphqlHttpContext } from '~/global/graphql/graphql-context.js';

@Resolver()
export class AuthResolver {
    constructor(
        private readonly authService: AuthService,
        private readonly loginRateLimiter: LoginRateLimiter
    ) {}

    @Mutation(() => LoginPayload, { name: 'login', description: '사용자 로그인' })
    async login(@Args('input') input: LoginInput, @Context() { req }: GraphqlHttpContext): Promise<LoginPayload> {
        await this.loginRateLimiter.assertAllowed(input.email, req.socket.remoteAddress ?? 'unknown');

        return this.authService.login(input);
    }

    @Mutation(() => RefreshTokenPayload, { name: 'refreshToken', description: '토큰 재발급' })
    refreshToken(@Args('input') input: RefreshTokenInput): Promise<RefreshTokenPayload> {
        return this.authService.token(input);
    }
}
