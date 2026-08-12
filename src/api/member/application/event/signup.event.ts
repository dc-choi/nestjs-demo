export class SignupEvent {
    constructor(
        public readonly email: string,
        public readonly name: string,
        public readonly phone: string,
        public readonly to: string
    ) {}
}
