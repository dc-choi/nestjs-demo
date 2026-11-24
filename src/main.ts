import type { LoggerService } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';

import { AppModule } from './app.module.js';

import type { EnvConfig } from '~/global/config/env/env.config.js';
import { applyTrustProxy } from '~/global/config/trust-proxy.js';
import { APPLICATION_LOGGER } from '~/global/logger/application-logger.symbol.js';

async function bootstrap() {
    const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true, bufferLogs: true });
    app.useLogger(app.get<LoggerService>(APPLICATION_LOGGER));
    const port = Number(process.env.SERVER_PORT) || 3000;

    applyTrustProxy(app, app.get(ConfigService).get<EnvConfig['TRUST_PROXY']>('TRUST_PROXY'));

    app.enableShutdownHooks();

    app.enableCors({
        exposedHeaders: ['x-request-id'],
    });

    await app.listen(port);
}
bootstrap();
