// INFO: 영문 대소문자, 숫자, 특수문자(_) 허용, 5자 이상 19자 이하
export const NAME_REGEXP = /^[a-zA-Z0-9_]{5,19}$/;

// INFO: 맨 앞자리는 영문 대소문자로 시작하는 숫자, 특수문자 허용, 8자 이상 16자 이하
export const PASSWORD_REGEXP = /^[a-zA-Z0-9!@#$%^&*()-_=+[\]{};:'",.<>/?]{8,16}$/;

// INFO: 숫자만 허용, 최대 19자리
export const PHONE_REGEXP = /^\+?\d{1,19}$/;
