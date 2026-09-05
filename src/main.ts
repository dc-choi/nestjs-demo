import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';

import { applicationLogger } from '~/global/config/logger/winston.config';

async function bootstrap() {
    const app = await NestFactory.create(AppModule, { rawBody: true, logger: applicationLogger });
    const port = Number(process.env.SERVER_PORT) || 3000;

    app.enableShutdownHooks();

    app.enableCors({
        exposedHeaders: ['x-request-id'],
    });

    await app.listen(port);
}
bootstrap();
