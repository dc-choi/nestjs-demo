export const MemberRole = {
    ADMIN: 'ADMIN',
    SELLER: 'SELLER',
    CUSTOMER: 'CUSTOMER',
    GUEST: 'GUEST',
} as const;

export type MemberRole = (typeof MemberRole)[keyof typeof MemberRole];
