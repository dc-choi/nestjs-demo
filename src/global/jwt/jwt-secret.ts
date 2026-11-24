import type { ConfigService } from '@nestjs/config';

import type { EnvConfig } from '~/global/config/env/env.config.js';

/**
 * Access token 서명(auth)과 검증(JwtStrategy)이 같은 key를 쓰도록 한곳에서 고른다.
 * JWT_SECRET이 없으면 기존 SECRET을 쓴다. SECRET은 legacy 비밀번호 HMAC pepper이므로 JWT key를 바꿀 때는
 * SECRET 대신 JWT_SECRET을 지정한다.
 */
export function resolveJwtSecret(config: ConfigService<EnvConfig, true>): string {
    return config.get<string>('JWT_SECRET') ?? config.get<string>('SECRET');
}
