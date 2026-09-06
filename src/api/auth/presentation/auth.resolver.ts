import { Args, Context, Mutation, Resolver } from '@nestjs/graphql';

import { AuthService } from '../application/auth.service';
import { LoginRateLimiter } from '../application/login-rate-limiter';
import { LoginInput } from './login.input';
import { LoginPayload } from './login.payload';
import { RefreshTokenInput } from './refresh-token.input';
import { RefreshTokenPayload } from './refresh-token.payload';

import { GraphqlHttpContext } from '~/global/graphql/graphql-context';

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
