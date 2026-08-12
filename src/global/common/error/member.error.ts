export class ExistingMember {
    message = '존재하는 사용자입니다.';

    type = 'EXISTING_MEMBER';
}

export class NotExistingMember {
    message = '존재하지 않는 사용자입니다.';

    type = 'NOT_EXISTING_USER';
}

export class InvalidMember {
    message = '유효하지 않은 이름의 사용자입니다.';

    type = 'INVALID_NAME';
}
