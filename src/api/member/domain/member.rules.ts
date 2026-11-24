export const NAME_MAX_LENGTH = 20;
export const PHONE_MAX_LENGTH = 255;
export const PASSWORD_MAX_LENGTH = 16;
export const EMAIL_MAX_LENGTH = 255;

// 영문 대소문자, 숫자, 특수문자(_) 허용, 5자 이상 19자 이하
export const NAME_REGEXP = /^[a-zA-Z0-9_]{5,19}$/;

// 영문 대소문자, 숫자와 특수문자 !@#$%^&*()-_=+[]{};:'",.<>/? 허용, 8자 이상 16자 이하. 첫 글자 제한은 없다.
// `-`를 escape하지 않으면 `)-_`가 0x29-0x5F 범위가 되어 `\`까지 허용한다.
export const PASSWORD_REGEXP = /^[a-zA-Z0-9!@#$%^&*()\-_=+[\]{};:'",.<>/?]{8,16}$/;

// 앞의 +를 선택적으로 허용하는 숫자 1자 이상 19자 이하
export const PHONE_REGEXP = /^\+?\d{1,19}$/;

// 회원 이름으로 쓸 수 없는 관리자성 이름
export const ID_BLACK_LIST = Object.freeze([
    'admin',
    'administrator',
    'root',
    'rootadmin',
    'superuser',
    'super',
    'sysadmin',
    'system',
    'systemadministrator',
    'systemadmin',
    'sysadministrator',
]);

/** 대소문자만 바꾼 관리자성 이름(`Admin`, `ROOT`)도 막는다. */
export function isReservedMemberName(name: string): boolean {
    return ID_BLACK_LIST.includes(name.toLowerCase());
}
