import { MailerService } from '@nestjs-modules/mailer';
import { Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventsHandler, IEventHandler } from '@nestjs/cqrs';

import { SignupEvent } from '~/api/member/application/event/signup.event';
import { type TypedLogger, VERBOSE_LOGGER, type VerbosePayload } from '~/global/common/logger/channel.logger';
import { EnvConfig } from '~/global/config/env/env.config';

@EventsHandler(SignupEvent)
export class SignupMailHandler implements IEventHandler<SignupEvent> {
    constructor(
        private readonly mailerService: MailerService,
        private readonly config: ConfigService<EnvConfig, true>,
        @Inject(VERBOSE_LOGGER) private readonly verboseLog: TypedLogger<VerbosePayload>
    ) {}

    handle(event: SignupEvent): void {
        const { email, name, phone, to } = event;

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
