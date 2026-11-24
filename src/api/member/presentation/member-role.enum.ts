import { registerEnumType } from '@nestjs/graphql';

import { MemberRole } from '../domain/entity/member-role.js';

registerEnumType(MemberRole, {
    name: 'MemberRole',
    description: '회원 권한',
});

export { MemberRole };
