import { registerEnumType } from '@nestjs/graphql';

import { MemberRole } from 'prisma/generated/client/enums';

registerEnumType(MemberRole, {
    name: 'MemberRole',
    description: '회원 권한',
});

export { MemberRole };
