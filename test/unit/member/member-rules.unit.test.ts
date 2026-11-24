import { describe, expect, it } from 'vitest';
import { PASSWORD_REGEXP, isReservedMemberName } from '~/api/member/domain/member.rules.js';

describe('PASSWORD_REGEXP', () => {
    it.each(['password1', '1password', 'pass-word', 'p@ss_w0rd!', `pa'ss"wd[]{}`, 'A'.repeat(16)])(
        'accepts %s',
        (password) => {
            expect(PASSWORD_REGEXP.test(password)).toBe(true);
        }
    );

    // `)-_`가 범위로 해석되던 때는 0x29-0x5F 안의 `\`도 허용했다.
    it.each(['pass\\word', 'pass word', 'pass~word', 'short1', 'a'.repeat(17)])('rejects %s', (password) => {
        expect(PASSWORD_REGEXP.test(password)).toBe(false);
    });
});

describe('isReservedMemberName', () => {
    it.each(['admin', 'Admin', 'ROOT', 'SysAdmin'])('rejects %s regardless of case', (name) => {
        expect(isReservedMemberName(name)).toBe(true);
    });

    it('allows ordinary names', () => {
        expect(isReservedMemberName('adminton')).toBe(false);
    });
});
