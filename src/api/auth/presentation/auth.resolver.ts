import { Args, Mutation, Resolver } from '@nestjs/graphql';

import { AuthService } from '../application/auth.service';
import { LoginInput } from './login.input';
import { LoginPayload } from './login.payload';
import { RefreshTokenInput } from './refresh-token.input';
import { RefreshTokenPayload } from './refresh-token.payload';

@Resolver()
export class AuthResolver {
    constructor(private readonly authService: AuthService) {}

    @Mutation(() => LoginPayload, { name: 'login', description: '사용자 로그인' })
    login(@Args('input') input: LoginInput): Promise<LoginPayload> {
        return this.authService.login(input);
    }

    @Mutation(() => RefreshTokenPayload, { name: 'refreshToken', description: '토큰 재발급' })
    refreshToken(@Args('input') input: RefreshTokenInput): Promise<RefreshTokenPayload> {
        return this.authService.token(input);
    }
}
