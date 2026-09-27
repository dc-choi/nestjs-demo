export class PasswordKdfSaturatedError extends Error {
    constructor() {
        super('Password KDF capacity is exhausted');
    }
}
