import { Controller, Get, Module, Req } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';

import type { Request } from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { envValidationSchema } from '~/global/config/env/env.validation.js';
import { applyTrustProxy } from '~/global/config/trust-proxy.js';

@Controller()
class ClientIpController {
    @Get('ip')
    ip(@Req() req: Request): string {
        return req.ip ?? '';
    }
}

@Module({ controllers: [ClientIpController] })
class ClientIpModule {}

const FORGED_IP = '203.0.113.7';
let app: NestExpressApplication | undefined;

afterEach(async () => {
    await app?.close();
    app = undefined;
});

async function clientIpWith(trustProxyEnv: string | undefined): Promise<string> {
    const { error, value } = envValidationSchema.extract('TRUST_PROXY').validate(trustProxyEnv, { convert: true });
    expect(error).toBeUndefined();

    app = await NestFactory.create<NestExpressApplication>(ClientIpModule, { logger: false });
    applyTrustProxy(app, value);
    await app.listen(0, '127.0.0.1');
    const response = await fetch(`${await app.getUrl()}/ip`, { headers: { 'x-forwarded-for': FORGED_IP } });
    return response.text();
}

describe('applyTrustProxy', () => {
    it('ignores X-Forwarded-For when TRUST_PROXY is unset so clients cannot pick their rate-limit key', async () => {
        await expect(clientIpWith(undefined)).resolves.toMatch(/127\.0\.0\.1$/);
    });

    it('uses the forwarded client address when TRUST_PROXY=1 arrives as an env string', async () => {
        await expect(clientIpWith('1')).resolves.toBe(FORGED_IP);
    });
});
