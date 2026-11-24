import { MailerService } from '@nestjs-modules/mailer';
import { Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventsHandler, IEventHandler } from '@nestjs/cqrs';

import { SignupEvent } from '~/api/member/application/event/signup.event.js';
import { EnvConfig } from '~/global/config/env/env.config.js';
import { type TypedLogger, type VerbosePayload } from '~/global/logger/channel.logger.js';
import { VERBOSE_LOGGER } from '~/global/logger/verbose-logger.symbol.js';

@EventsHandler(SignupEvent)
export class SignupMailHandler implements IEventHandler<SignupEvent> {
    constructor(
        private readonly mailerService: MailerService,
        private readonly config: ConfigService<EnvConfig, true>,
        @Inject(VERBOSE_LOGGER) private readonly verboseLog: TypedLogger<VerbosePayload>
    ) {}

    handle(event: SignupEvent): void {
        const { email, name, phone } = event;
        const to = this.config.get<string>('MAIL_SIGNUP_ALERT_USER');

        this.mailerService
            .sendMail({
                to: to.split(','),
                subject: `[회원 유입] ${name}님이 가입하셨습니다.`,
                template: './signup',
                context: {
                    name,
                    email,
                    phone,
                },
            })
            .catch((e) => {
                this.verboseLog.log({
                    type: 'SIGNUP_MAIL_ERROR',
                    env: this.config.get<string>('ENV'),
                    stack: e.stack,
                    message: `SIGNUP_MAIL_ERROR - ${e.message}`,
                });
            });
    }
}
