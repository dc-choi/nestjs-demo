import type { LoggerService } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';

import { APPLICATION_LOGGER } from '~/global/common/logger/channel.logger';

async function bootstrap() {
    const app = await NestFactory.create(AppModule, { rawBody: true, bufferLogs: true });
    app.useLogger(app.get<LoggerService>(APPLICATION_LOGGER));
    const port = Number(process.env.SERVER_PORT) || 3000;

    app.enableShutdownHooks();

    app.enableCors({
        exposedHeaders: ['x-request-id'],
    });

    await app.listen(port);
}
bootstrap();
