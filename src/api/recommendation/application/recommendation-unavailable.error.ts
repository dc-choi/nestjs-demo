export class RecommendationUnavailableError extends Error {
    constructor(
        readonly code: 'PROFILE_UNAVAILABLE' | 'SEARCH_DISABLED' | 'SEARCH_UNAVAILABLE',
        message: string,
        options?: ErrorOptions
    ) {
        super(message, options);
        this.name = RecommendationUnavailableError.name;
    }
}
