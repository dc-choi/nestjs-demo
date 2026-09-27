export class OpenSearchHttpError extends Error {
    constructor(
        readonly status: number | null,
        readonly responseBody: unknown,
        message: string,
        options?: ErrorOptions
    ) {
        super(message, options);
        this.name = OpenSearchHttpError.name;
    }

    get isNotFound(): boolean {
        return this.status === 404;
    }
}
