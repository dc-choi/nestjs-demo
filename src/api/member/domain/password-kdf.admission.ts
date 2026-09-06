export const DEFAULT_PASSWORD_KDF_CONCURRENCY = 1;

export class PasswordKdfSaturatedError extends Error {
    constructor() {
        super('Password KDF capacity is exhausted');
    }
}

export class PasswordKdfAdmission {
    private active = 0;

    constructor(private readonly capacity = DEFAULT_PASSWORD_KDF_CONCURRENCY) {}

    async run<T>(operation: () => Promise<T>): Promise<T> {
        if (this.active >= this.capacity) throw new PasswordKdfSaturatedError();

        this.active += 1;
        try {
            return await operation();
        } finally {
            this.active -= 1;
        }
    }
}
