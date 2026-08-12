import { createHmac } from 'node:crypto';

export class MemberDomain {
    public static generateHashedPassword(password: string, salt: string) {
        return createHmac('sha256', salt).update(password).digest('base64');
    }
}
