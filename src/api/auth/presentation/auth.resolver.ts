import { Args, Context, Mutation, Resolver } from '@nestjs/graphql';

import { AuthService } from '../application/auth.service.js';
import { LoginInput } from './login.input.js';
import { LoginPayload } from './login.payload.js';
import { RefreshTokenInput } from './refresh-token.input.js';
import { RefreshTokenPayload } from './refresh-token.payload.js';

import type { GraphqlHttpContext } from '~/global/graphql/graphql-context.js';

@Resolver()
export class AuthResolver {
    constructor(private readonly authService: AuthService) {}

    @Mutation(() => LoginPayload, { name: 'login', description: '사용자 로그인' })
    login(@Args('input') input: LoginInput, @Context() { req }: GraphqlHttpContext): Promise<LoginPayload> {
        // TRUST_PROXY가 없으면 req.ip는 TCP peer 주소이고, 있으면 Express가 신뢰한 proxy 뒤의 주소다.
        return this.authService.login({ email: input.email, password: input.password, clientIp: req.ip ?? 'unknown' });
    }

    @Mutation(() => RefreshTokenPayload, { name: 'refreshToken', description: '토큰 재발급' })
    refreshToken(@Args('input') input: RefreshTokenInput): Promise<RefreshTokenPayload> {
        return this.authService.token(input);
    }
}
