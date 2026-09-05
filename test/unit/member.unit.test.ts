import { describe, expect, it } from 'vitest';
import { MemberDomain } from '~/api/member/domain/member.domain';

describe('Member Unit Test', () => {
    describe('MemberDomain.generateHashedPassword', () => {
        it('normal case', () => {
            const newPassword = MemberDomain.generateHashedPassword('password', String(process.env.SECRET));
            expect(newPassword).toBeTruthy();
            expect(newPassword).not.toBeNull();
        });

        it('wrong secret key', () => {
            const password = MemberDomain.generateHashedPassword('password', String(process.env.SECRET));

            const wrongPassword = MemberDomain.generateHashedPassword('password', '');

            expect(password).not.toBe(wrongPassword);
        });
    });
});
