import { validateSync } from 'class-validator';

import { describe, expect, it } from 'vitest';
import { LoginInput } from '~/api/auth/presentation/login.input';
import { SignupInput } from '~/api/member/presentation/signup.input';

const validEmails = ['alice+shop@example.com', 'alice@example.technology'];
const invalidEmails = ['alice..shop@example.com', 'alice@-example.com'];

describe('email input validation', () => {
    for (const [inputName, createInput] of Object.entries({
        login: (email: string) => Object.assign(new LoginInput(), { email, password: 'password' }),
        signup: (email: string) =>
            Object.assign(new SignupInput(), {
                name: 'member',
                email,
                password: 'password123',
                phone: '01012345678',
            }),
    })) {
        it.each(validEmails)(`${inputName} accepts %s`, (email) => {
            expect(validateSync(createInput(email))).toEqual([]);
        });

        it.each(invalidEmails)(`${inputName} rejects %s`, (email) => {
            expect(validateSync(createInput(email)).some(({ property }) => property === 'email')).toBe(true);
        });
    }
});
