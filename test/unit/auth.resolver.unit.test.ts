import { HttpException, HttpStatus } from '@nestjs/common';

import { describe, expect, it, vi } from 'vitest';
import { AuthService } from '~/api/auth/application/auth.service';
import { LoginRateLimiter } from '~/api/auth/application/login-rate-limiter';
import { AuthResolver } from '~/api/auth/presentation/auth.resolver';
import { LoginRateLimited } from '~/global/common/error/auth.error';
import { GraphqlHttpContext } from '~/global/graphql/graphql-context';

describe('AuthResolver', () => {
    const input = { email: 'member@example.com', password: 'password' };

    it('rate-limits before calling the login service and uses the TCP peer instead of forwarded headers', async () => {
        const authService = { login: vi.fn() } as unknown as AuthService;
        const loginRateLimiter = {
            assertAllowed: vi
                .fn()
                .mockRejectedValue(new HttpException(new LoginRateLimited(), HttpStatus.TOO_MANY_REQUESTS)),
        } as unknown as LoginRateLimiter;
        const resolver = new AuthResolver(authService, loginRateLimiter);
        const context = {
            req: {
                headers: { 'x-forwarded-for': '203.0.113.50' },
                socket: { remoteAddress: '198.51.100.20' },
            },
        } as unknown as GraphqlHttpContext;

        await expect(resolver.login(input, context)).rejects.toBeInstanceOf(HttpException);

        expect(loginRateLimiter.assertAllowed).toHaveBeenCalledWith(input.email, '198.51.100.20');
        expect(authService.login).not.toHaveBeenCalled();
    });
});
