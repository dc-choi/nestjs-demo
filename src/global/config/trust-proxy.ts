import type { NestExpressApplication } from '@nestjs/platform-express';

import type { EnvConfig } from '~/global/config/env/env.config.js';

/**
 * 검증된 `TRUST_PROXY`만 Express에 넘긴다. Express는 문자열 `'1'`을 주소로 해석해 조용히 무시하므로 Joi가 숫자로
 * 바꾼 값을 써야 한다. 값이 없으면 `req.ip`는 TCP peer 주소다.
 */
export function applyTrustProxy(app: Pick<NestExpressApplication, 'set'>, trustProxy: EnvConfig['TRUST_PROXY']): void {
    if (trustProxy !== undefined) app.set('trust proxy', trustProxy);
}
