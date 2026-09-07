import { describe, expect, it, vi } from 'vitest';
import { SignupEvent } from '~/api/member/application/event/signup.event';
import { SignupMailHandler } from '~/infra/mail/handler/signup.mail.handler';

describe('SignupMailHandler', () => {
    it('selects signup-alert recipients from its own mail configuration', () => {
        const sendMail = vi.fn().mockResolvedValue(undefined);
        const config = { get: vi.fn().mockReturnValue('operator@example.com,backup@example.com') };
        const handler = new SignupMailHandler({ sendMail } as never, config as never, { log: vi.fn() } as never);

        handler.handle(new SignupEvent('member@example.com', '신규회원', '01012345678'));

        expect(config.get).toHaveBeenCalledWith('MAIL_SIGNUP_ALERT_USER');
        expect(sendMail).toHaveBeenCalledWith({
            to: ['operator@example.com', 'backup@example.com'],
            subject: '[회원 유입] 신규회원님이 가입하셨습니다.',
            template: './signup',
            context: {
                name: '신규회원',
                email: 'member@example.com',
                phone: '01012345678',
            },
        });
    });
});
