interface SearchCursorSecretConfig {
    get<T = unknown>(propertyPath: string): T | undefined;
}

export function resolveProductSearchCursorSecret(config: SearchCursorSecretConfig): string {
    const enabled = config.get<unknown>('OPENSEARCH_ENABLED');
    const secret = config.get<unknown>('OPENSEARCH_CURSOR_SECRET') ?? config.get<unknown>('SECRET');
    if (typeof secret === 'string' && secret.length >= 32) return secret;
    if (enabled === true || enabled === 'true') {
        throw new Error(
            'OPENSEARCH_CURSOR_SECRET or SECRET must contain at least 32 characters when OpenSearch is enabled'
        );
    }
    if (typeof secret === 'string' && secret.length > 0) return secret;
    return 'search-disabled';
}
