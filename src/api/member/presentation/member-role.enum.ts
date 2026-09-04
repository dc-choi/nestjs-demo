import { registerEnumType } from '@nestjs/graphql';

import { MemberRole } from '../domain/member-role';

registerEnumType(MemberRole, {
    name: 'MemberRole',
    description: '회원 권한',
});

export { MemberRole };
