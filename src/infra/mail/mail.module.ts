import { MailerModule } from '@nestjs-modules/mailer';
import { HandlebarsAdapter } from '@nestjs-modules/mailer/adapters/handlebars.adapter';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { CqrsModule } from '@nestjs/cqrs';

import { SignupMailHandler } from './handler/signup.mail.handler';

import { join } from 'node:path';
import { EnvConfig } from '~/global/config/env/env.config';

@Module({
    imports: [
        MailerModule.forRootAsync({
            imports: [ConfigModule],
            inject: [ConfigService],
            useFactory: (configService: ConfigService<EnvConfig, true>) => {
                return {
                    transport: {
                        host: 'smtp.gmail.com',
                        port: 465,
                        secure: true,
                        auth: {
                            user: configService.get<string>('MAIL_USER'),
                            pass: configService.get<string>('MAIL_PASSWORD'),
                        },
                    },
                    defaults: {
                        from: 'Choi Dond Chul',
                    },
                    template: {
                        // __dirname 기준으로 source, Nest build, SWC build에서 같은 상대 위치를 사용한다.
                        dir: join(__dirname, '../../global/templates'),
                        adapter: new HandlebarsAdapter(),
                        options: {
                            strict: true,
                        },
                    },
                };
            },
        }),
        CqrsModule,
    ],
    providers: [SignupMailHandler],
})
export class MailModule {}
