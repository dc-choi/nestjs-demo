import { describe, expect, it, vi } from 'vitest';
import { AuthService } from '~/api/auth/application/auth.service.js';
import { AuthResolver } from '~/api/auth/presentation/auth.resolver.js';
import { GraphqlHttpContext } from '~/global/graphql/graphql-context.js';

describe('AuthResolver', () => {
    const input = { email: 'member@example.com', password: 'password' };

    it('passes the Express client IP instead of forwarded headers to the login service', async () => {
        const authService = { login: vi.fn().mockResolvedValue({}) } as unknown as AuthService;
        const resolver = new AuthResolver(authService);
        // Express는 trust proxy가 없으면 req.ip로 TCP peer 주소를 돌려준다.
        const context = {
            req: {
                ip: '198.51.100.20',
                headers: { 'x-forwarded-for': '203.0.113.50' },
                socket: { remoteAddress: '198.51.100.20' },
            },
        } as unknown as GraphqlHttpContext;

        await resolver.login(input, context);

        expect(authService.login).toHaveBeenCalledWith({ ...input, clientIp: '198.51.100.20' });
    });
});
